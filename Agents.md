# MiniRAFT Distributed System Ledger

This document serves as the master ledger for the architecture, rules, and component responsibilities of the MiniRAFT project.

---

## 1. System Components & Port Mappings

| Component | Language/Tech | Internal Port | Exposed Port | Responsibility |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend** | TypeScript / Next.js | 3000 | 3000 | Client UI, canvas drawing, WebSocket connection to Gateway. |
| **Gateway** | TypeScript / Bun / Hono | 8080 | 8080 | Maintains WS connections, routes HTTP requests to the active Leader, broadcasts committed strokes. |
| **Replica 1** | Go / Fiber | 9001 | 9001 | RAFT Node (can be Leader, Follower, or Candidate). Maintains stroke log. |
| **Replica 2** | Go / Fiber | 9002 | 9002 | RAFT Node (can be Leader, Follower, or Candidate). Maintains stroke log. |
| **Replica 3** | Go / Fiber | 9003 | 9003 | RAFT Node (can be Leader, Follower, or Candidate). Maintains stroke log. |

---

## 2. RAFT State Machine Rules

Each Replica node in the cluster operates as a state machine with three possible states:

### 2.1 State Definitions

| State | Description | Transitions To |
| :--- | :--- | :--- |
| **FOLLOWER** | Default starting state. Passively waits for RPCs from Leader or Candidate. | CANDIDATE (on election timeout) |
| **CANDIDATE** | Actively seeking votes to become Leader. | LEADER (on majority vote), FOLLOWER (on higher term discovered) |
| **LEADER** | Accepts client requests, replicates log entries, sends heartbeats. | FOLLOWER (on higher term discovered) |

### 2.2 State Behaviors

*   **FOLLOWER:** 
    *   Default starting state.
    *   Expects periodic heartbeats from the Leader.
    *   If no heartbeat is received within the **Election Timeout**, transitions to CANDIDATE.
    *   Responds to `RequestVote` RPCs from Candidates.
    *   Appends entries from `AppendEntries` RPCs sent by the Leader.

*   **CANDIDATE:**
    *   Increments the current `term`.
    *   Votes for itself and sends `RequestVote` RPCs to all peers.
    *   If it receives votes from a majority (2 out of 3), transitions to LEADER.
    *   If it discovers a Leader with a higher or equal term, reverts to FOLLOWER.
    *   If election times out without a winner, starts a new election with incremented term.

*   **LEADER:**
    *   Accepts drawing strokes from the Gateway.
    *   Sends heartbeats (empty `AppendEntries` RPCs) to all peers every **150ms** to maintain authority.
    *   Replicates log entries to peers. Once a majority ACKs the entry, it is marked as committed.
    *   Tracks `nextIndex` and `matchIndex` for each follower to manage replication.
    *   Handles `/sync-log` requests for followers that have fallen behind.

---

## 3. Timing Constraints

| Parameter | Value | Description |
| :--- | :--- | :--- |
| **Heartbeat Interval** | `150ms` | Leader sends keep-alive to prevent Followers from triggering elections. |
| **Election Timeout** | `500ms - 800ms` | Randomized per node. Follower waits this long before starting an election. |
| **Majority Quorum** | `≥ 2` | Requires 2 out of 3 nodes for a successful election or log commit. |

### 3.1 Why These Values?

*   **Election Timeout > Heartbeat Interval**: This ensures that a Follower will receive multiple heartbeats before it times out. If the Leader is alive, the Follower will never start an unnecessary election.
*   **Randomized Election Timeout**: Prevents "split vote" scenarios where multiple nodes become Candidates simultaneously and split the vote, causing no one to win. By randomizing, one node will almost always time out first.

---

## 4. Safety & Catch-up Protocols

*   **Log Consistency:** Committed entries are *never* overwritten.
*   **Term Authority:** Any node seeing a higher term in any RPC immediately reverts to FOLLOWER and updates its term.
*   **Vote Restriction:** A node can only vote once per term. Once `VotedFor` is set, it cannot change until a new term begins.
*   **Log Matching Property:** If two logs contain an entry with the same index and term, then the logs are identical in all entries up through the given index.

### 4.1 Catch-Up Protocol (`/sync-log`)

When a crashed node restarts, its log is empty (term=0). The Leader detects the mismatch via `AppendEntries` failure and calls `/sync-log` to send all committed entries from index 0 onward, bringing the Follower back in sync.

```
Restarted node (empty log, term=0)
    │
    │ receives AppendEntries from leader
    │ prevLogIndex check FAILS (log is empty)
    │
    ▼
Node responds with { success: false, logLength: 0 }
    │
    ▼
Leader calls POST /sync-log on follower
    sending all committed entries from index 0 onward
    │
    ▼
Follower appends all entries, updates commitIndex
    │
    ▼
Follower participates normally in future AppendEntries
```

---

## 5. API Reference (HTTP/JSON RPCs)

All replica RPC endpoints are HTTP/JSON. The Gateway and other replicas call these internally.

### 5.1 `POST /request-vote`

Called by a Candidate during election to request a vote from peers.

**Request:**
```json
{
  "term": 3,
  "candidateId": "replica2",
  "lastLogIndex": 12,
  "lastLogTerm": 2
}
```

**Response:**
```json
{
  "term": 3,
  "voteGranted": true
}
```

**Logic:**
1. If `request.term < currentTerm`, reject (return `voteGranted: false`).
2. If `request.term > currentTerm`, step down to Follower, update term.
3. If `votedFor` is empty or equals `candidateId`, AND candidate's log is at least as up-to-date as receiver's log, grant vote.

---

### 5.2 `POST /append-entries`

Called by the Leader to replicate log entries (or as a heartbeat when `entries` is empty).

**Request:**
```json
{
  "term": 3,
  "leaderId": "replica1",
  "prevLogIndex": 11,
  "prevLogTerm": 2,
  "entries": [
    {
      "index": 12,
      "term": 3,
      "stroke": {
        "x0": 100, "y0": 200,
        "x1": 150, "y1": 250,
        "color": "#e63946",
        "width": 3
      }
    }
  ],
  "leaderCommit": 11
}
```

**Response:**
```json
{
  "term": 3,
  "success": true,
  "logLength": 12
}
```

**Logic:**
1. If `request.term < currentTerm`, reject.
2. If `request.term >= currentTerm`, reset election timer (leader is alive).
3. If log doesn't contain an entry at `prevLogIndex` with term `prevLogTerm`, reject (triggers sync-log).
4. Append any new entries not already in the log.
5. If `leaderCommit > commitIndex`, set `commitIndex = min(leaderCommit, index of last new entry)`.

---

### 5.3 `POST /heartbeat`

Lightweight keep-alive from Leader to Followers (no log entries). This is a simplified version of `AppendEntries` with no entries.

**Request:**
```json
{
  "term": 3,
  "leaderId": "replica1"
}
```

**Response:**
```json
{
  "term": 3,
  "success": true
}
```

**Logic:**
1. If `request.term < currentTerm`, reject.
2. If `request.term >= currentTerm`, reset election timer, update `currentTerm` if needed.
3. Return success.

---

### 5.4 `POST /sync-log`

Called by the Leader on a rejoining Follower to send all missing committed entries.

**Request:**
```json
{
  "fromIndex": 0,
  "entries": [
    { "index": 0, "term": 1, "stroke": { ... } },
    { "index": 1, "term": 1, "stroke": { ... } },
    ...
  ]
}
```

**Response:**
```json
{
  "success": true,
  "syncedUpTo": 47
}
```

**Logic:**
1. Clear local log (if `fromIndex` is 0).
2. Append all received entries.
3. Update `commitIndex` to the last entry's index.
4. Return the index of the last synced entry.

---

### 5.5 `GET /status`

Returns current node state. Used by the Gateway to discover the active leader.

**Response:**
```json
{
  "replicaId": "replica1",
  "state": "leader",
  "term": 3,
  "commitIndex": 47,
  "logLength": 48
}
```

---

## 6. Environment Variables

| Variable | Service | Default | Description |
| :--- | :--- | :--- | :--- |
| `REPLICA_ID` | Replica | (required) | Unique node identifier (`replica1`, `replica2`, `replica3`) |
| `PORT` | Replica | (required) | HTTP port for RPC endpoints |
| `PEERS` | Replica | (required) | Comma-separated URLs of all other replicas |
| `REPLICA_URLS` | Gateway | (required) | Comma-separated URLs of all replicas (for leader discovery) |
| `GATEWAY_PORT` | Gateway | `8080` | WebSocket + HTTP port |
| `ELECTION_TIMEOUT_MIN` | Replica | `500` | Minimum election timeout in ms |
| `ELECTION_TIMEOUT_MAX` | Replica | `800` | Maximum election timeout in ms |
| `HEARTBEAT_INTERVAL` | Replica | `150` | Leader heartbeat interval in ms |

---

## 7. Implementation Progress Tracker

### 7.1 Replica (Go/Fiber) Components

| File | Status | Description |
| :--- | :--- | :--- |
| `replica1/raft/log.go` | ✅ Done | Stroke and LogEntry structs, LogManager with append operations |
| `replica1/raft/node.go` | ✅ Done | Node struct, State enum, NewNode constructor, BecomeFollower, Lock/Unlock |
| `replica1/raft/election.go` | ✅ Done | Election timeout loop, StartElection, RequestVote RPC logic |
| `replica1/raft/replication.go` | ✅ Done | AppendEntries, Heartbeat sending, SyncLog logic, LeaderState |
| `replica1/handlers/rpc.go` | ✅ Done | HTTP handlers for all RPC endpoints + /stroke + /log debug |
| `replica1/main.go` | ✅ Done | Entry point, env parsing, Fiber server setup, middleware |
| `replica1/Dockerfile` | ✅ Done | Multi-stage build for Go + Air hot-reload |
| `replica1/.air.toml` | ✅ Done | Hot-reload configuration |

### 7.2 Gateway (TypeScript/Bun/Hono) Components

| File | Status | Description |
| :--- | :--- | :--- |
| `gateway/index.ts` | ✅ Done | Entry point, Bun server startup |
| `gateway/app.ts` | ✅ Done | Hono app factory with WebSocket upgrade |
| `gateway/leader.ts` | ✅ Done | LeaderTracker class - polls replicas, identifies leader |
| `gateway/ws.ts` | ✅ Done | WebSocket handlers (onOpen, onMessage, onClose) |
| `gateway/types.ts` | ✅ Done | Zod StrokeSchema + TypeScript types |
| `gateway/tests/` | ✅ Done | Unit + Integration + Smoke tests |

### 7.3 Frontend (TypeScript/Next.js) Components

| File | Status | Description |
| :--- | :--- | :--- |
| `frontend/src/app/page.tsx` | ✅ Done | Main page, renders Canvas component |
| `frontend/src/app/layout.tsx` | ✅ Done | Root layout with metadata |
| `frontend/src/components/Canvas.tsx` | ✅ Done | Drawing canvas with WebSocket integration |
| `frontend/src/hooks/useWebSocket.ts` | ✅ Done | WebSocket hook with auto-reconnect |

### 7.4 Infrastructure

| File | Status | Description |
| :--- | :--- | :--- |
| `docker-compose.yml` | ✅ Done | Full cluster orchestration (all 5 services) |
| `replica2/` | ✅ Done | Copy of replica1 |
| `replica3/` | ✅ Done | Copy of replica1 |

---

## 8. Logging Format

All replicas log key events to stdout in a structured format for easy parsing and debugging:

```
[replica1] term=3 state=LEADER    event=heartbeat_sent      peers=2
[replica1] term=3 state=LEADER    event=entry_committed     index=47
[replica2] term=3 state=FOLLOWER  event=vote_granted        for=replica1
[replica3] term=4 state=CANDIDATE event=election_started    timeout=612ms
[replica3] term=4 state=LEADER    event=election_won        votes=2
```

### 8.1 Event Types

| Event | Triggered When |
| :--- | :--- |
| `heartbeat_sent` | Leader sends heartbeat to all peers |
| `heartbeat_received` | Follower receives heartbeat from Leader |
| `entry_appended` | New log entry added to local log |
| `entry_committed` | Log entry reaches majority and is committed |
| `vote_requested` | Candidate sends RequestVote to peer |
| `vote_granted` | Node grants vote to a Candidate |
| `vote_denied` | Node denies vote to a Candidate |
| `election_started` | Node transitions to Candidate, starts election |
| `election_won` | Candidate receives majority votes, becomes Leader |
| `election_lost` | Candidate discovers higher term, reverts to Follower |
| `stepped_down` | Leader/Candidate reverts to Follower |
| `sync_log_sent` | Leader sends sync-log to a follower |
| `sync_log_received` | Follower receives and applies sync-log |

---

## 9. Critical Implementation Notes

### 9.1 Thread Safety (Go)

All access to `Node` struct fields MUST be protected by `node.mu.Lock()` / `node.mu.Unlock()`. This includes:
- Reading/writing `CurrentTerm`
- Reading/writing `VotedFor`
- Reading/writing `State`
- Reading/writing `CommitIndex`
- Accessing `Log.Entries`

### 9.2 Election Timer Reset

The election timer MUST be reset whenever:
1. A valid heartbeat is received from the current Leader
2. A vote is granted to a Candidate
3. The node transitions to Candidate (starts new election)

### 9.3 Term Monotonicity

The `CurrentTerm` must NEVER decrease. If a node sees a higher term in ANY RPC (request or response), it must immediately:
1. Update `CurrentTerm` to the higher term
2. Revert to Follower state
3. Clear `VotedFor`

### 9.4 Log Index Convention

- Log indices are **1-based** (first entry is index 1)
- An empty log has `lastLogIndex = 0` and `lastLogTerm = 0`
- `prevLogIndex = 0` means "append at the beginning of the log"

---

## 10. Testing Scenarios

| Scenario | Expected Behavior |
| :--- | :--- |
| Leader crash | Remaining nodes detect missing heartbeats, one wins election, becomes new Leader |
| Hot-reload of Leader | Same as crash; new instance starts as Follower, catches up via sync-log |
| Hot-reload of Follower | Follower restarts, catches up via sync-log, no election triggered |
| Network partition (minority) | Minority partition cannot elect leader (no quorum); majority continues |
| All nodes restart simultaneously | Random election timeouts cause one node to win election first |
