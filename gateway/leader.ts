import type { NodeStatus } from "./types";

type Logger = Pick<Console, "log">;
type FetchImpl = typeof fetch;

export type LeaderSource = {
  getLeaderUrl(): string | null;
};

type LeaderTrackerOptions = {
  peers: string[];
  fetchImpl?: FetchImpl;
  logger?: Logger;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
};

export class LeaderTracker implements LeaderSource {
  private leaderId: string | null = null;
  private leaderUrl: string | null = null;
  private term = 0;
  private readonly peers: string[];
  private readonly fetchImpl: FetchImpl;
  private readonly logger: Logger;
  private readonly pollIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private poller: Timer | null = null;

  constructor({
    peers,
    fetchImpl = fetch,
    logger = console,
    pollIntervalMs = 2000,
    requestTimeoutMs = 500,
  }: LeaderTrackerOptions) {
    this.peers = peers;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.pollIntervalMs = pollIntervalMs;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async pollOnce() {
    const statuses = await Promise.all(
      this.peers.map(async (peer) => {
        try {
          const response = await this.fetchImpl(`${peer}/status`, {
            signal: AbortSignal.timeout(this.requestTimeoutMs),
          });

          if (!response.ok) {
            return null;
          }

          const status = (await response.json()) as NodeStatus;
          return { peer, status };
        } catch {
          return null;
        }
      }),
    );

    const nextLeader = statuses
      .filter((candidate): candidate is { peer: string; status: NodeStatus } => candidate !== null)
      .filter(({ status }) => status.state === "LEADER")
      .sort((left, right) => right.status.term - left.status.term)[0];

    if (!nextLeader) {
      return;
    }

    const { peer, status } = nextLeader;
    const changedLeader = peer !== this.leaderUrl || status.term !== this.term;

    this.leaderId = status.replicaId;
    this.leaderUrl = peer;
    this.term = status.term;

    if (changedLeader) {
      this.logger.log(`[Gateway] Found Leader: ${peer} (Term ${status.term})`);
    }
  }

  startPolling() {
    if (this.poller) {
      return;
    }

    void this.pollOnce();
    this.poller = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
  }

  stopPolling() {
    if (!this.poller) {
      return;
    }

    clearInterval(this.poller);
    this.poller = null;
  }

  getLeaderUrl() {
    return this.leaderUrl;
  }

  getLeaderId() {
    return this.leaderId;
  }
}
