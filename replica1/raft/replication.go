package raft

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

















type AppendEntriesRequest struct {
	Term         int        `json:"term"`
	LeaderId     string     `json:"leaderId"`
	PrevLogIndex int        `json:"prevLogIndex"`
	PrevLogTerm  int        `json:"prevLogTerm"`
	Entries      []LogEntry `json:"entries"`
	LeaderCommit int        `json:"leaderCommit"`
}





type AppendEntriesResponse struct {
	Term      int  `json:"term"`
	Success   bool `json:"success"`
	LogLength int  `json:"logLength"`
}









type HeartbeatRequest struct {
	Term     int    `json:"term"`
	LeaderId string `json:"leaderId"`
}


type HeartbeatResponse struct {
	Term    int  `json:"term"`
	Success bool `json:"success"`
}











type SyncLogRequest struct {
	FromIndex int        `json:"fromIndex"`
	Entries   []LogEntry `json:"entries"`
}




type SyncLogResponse struct {
	Success    bool `json:"success"`
	SyncedUpTo int  `json:"syncedUpTo"`
}









type LeaderState struct {
	
	
	NextIndex map[string]int

	
	
	MatchIndex map[string]int
}







func (n *Node) InitLeaderState() {
	lastLogIndex, _ := n.Log.GetLastLogIndexAndTerm()

	n.LeaderState = &LeaderState{
		NextIndex:  make(map[string]int),
		MatchIndex: make(map[string]int),
	}

	
	
	
	for _, peer := range n.PeerURLs {
		n.LeaderState.NextIndex[peer] = lastLogIndex + 1
		n.LeaderState.MatchIndex[peer] = 0
	}
}











func (n *Node) RunHeartbeatLoop() {
	
	n.Mu.Lock()
	n.InitLeaderState()
	n.Mu.Unlock()

	
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()

	for {
		<-ticker.C

		n.Mu.Lock()
		
		if n.State != Leader {
			n.Mu.Unlock()
			n.Logger.Printf("term=%d state=%s event=heartbeat_loop_stopped", n.CurrentTerm, n.State)
			return
		}

		
		currentTerm := n.CurrentTerm
		leaderId := n.ID
		leaderCommit := n.CommitIndex
		peers := make([]string, len(n.PeerURLs))
		copy(peers, n.PeerURLs)

		n.Mu.Unlock()

		
		var wg sync.WaitGroup
		for _, peerURL := range peers {
			wg.Add(1)
			go func(url string) {
				defer wg.Done()
				n.sendHeartbeatToPeer(url, currentTerm, leaderId, leaderCommit)
			}(peerURL)
		}
		wg.Wait()

		n.Logger.Printf("term=%d state=LEADER event=heartbeat_sent peers=%d", currentTerm, len(peers))
	}
}



func (n *Node) sendHeartbeatToPeer(peerURL string, term int, leaderId string, leaderCommit int) {
	req := HeartbeatRequest{
		Term:     term,
		LeaderId: leaderId,
	}

	resp, err := n.sendHeartbeat(peerURL, req)
	if err != nil {
		
		return
	}

	
	n.Mu.Lock()
	if resp.Term > n.CurrentTerm {
		n.Logger.Printf("term=%d state=LEADER event=higher_term_discovered newTerm=%d from=%s",
			n.CurrentTerm, resp.Term, peerURL)
		n.BecomeFollower(resp.Term)
	}
	n.Mu.Unlock()
}













func (n *Node) HandleHeartbeat(req HeartbeatRequest) HeartbeatResponse {
	n.Mu.Lock()
	defer n.Mu.Unlock()

	response := HeartbeatResponse{
		Term:    n.CurrentTerm,
		Success: false,
	}

	
	if req.Term < n.CurrentTerm {
		n.Logger.Printf("term=%d state=%s event=heartbeat_rejected reason=stale_term senderTerm=%d sender=%s",
			n.CurrentTerm, n.State.String(), req.Term, req.LeaderId)
		return response
	}

	
	if req.Term > n.CurrentTerm {
		n.BecomeFollower(req.Term)
		response.Term = n.CurrentTerm
	} else if n.State == Candidate {
		
		
		n.BecomeFollower(req.Term)
	}

	
	n.ResetElectionTimer()
	response.Success = true

	n.Logger.Printf("term=%d state=%s event=heartbeat_received from=%s",
		n.CurrentTerm, n.State.String(), req.LeaderId)

	return response
}
















func (n *Node) HandleAppendEntries(req AppendEntriesRequest) AppendEntriesResponse {
	n.Mu.Lock()
	defer n.Mu.Unlock()

	response := AppendEntriesResponse{
		Term:      n.CurrentTerm,
		Success:   false,
		LogLength: len(n.Log.Entries),
	}

	
	if req.Term < n.CurrentTerm {
		n.Logger.Printf("term=%d state=%s event=append_entries_rejected reason=stale_term senderTerm=%d sender=%s",
			n.CurrentTerm, n.State.String(), req.Term, req.LeaderId)
		return response
	}

	
	if req.Term > n.CurrentTerm {
		n.BecomeFollower(req.Term)
		response.Term = n.CurrentTerm
	} else if n.State == Candidate {
		
		n.BecomeFollower(req.Term)
	}

	
	n.ResetElectionTimer()

	
	
	
	if req.PrevLogIndex > 0 {
		
		if req.PrevLogIndex > len(n.Log.Entries) {
			
			n.Logger.Printf("term=%d state=%s event=append_entries_rejected reason=log_too_short "+
				"prevLogIndex=%d ourLogLength=%d sender=%s",
				n.CurrentTerm, n.State.String(), req.PrevLogIndex, len(n.Log.Entries), req.LeaderId)
			return response
		}

		
		
		prevEntry := n.Log.Entries[req.PrevLogIndex-1]
		if prevEntry.Term != req.PrevLogTerm {
			
			
			n.Logger.Printf("term=%d state=%s event=append_entries_rejected reason=term_mismatch "+
				"prevLogIndex=%d expectedTerm=%d actualTerm=%d sender=%s",
				n.CurrentTerm, n.State.String(), req.PrevLogIndex, req.PrevLogTerm, prevEntry.Term, req.LeaderId)
			return response
		}
	}

	
	
	
	for i, entry := range req.Entries {
		entryIndex := req.PrevLogIndex + 1 + i

		if entryIndex <= len(n.Log.Entries) {
			
			existingEntry := n.Log.Entries[entryIndex-1]
			if existingEntry.Term != entry.Term {
				
				n.Log.Mu.Lock()
				n.Log.Entries = n.Log.Entries[:entryIndex-1]
				n.Log.Mu.Unlock()
				n.Logger.Printf("term=%d state=%s event=log_truncated at_index=%d",
					n.CurrentTerm, n.State.String(), entryIndex)
			}
		}

		
		if entryIndex > len(n.Log.Entries) {
			n.Log.Append(entry)
			n.Logger.Printf("term=%d state=%s event=entry_appended index=%d entryTerm=%d",
				n.CurrentTerm, n.State.String(), entry.Index, entry.Term)
		}
	}

	
	if req.LeaderCommit > n.CommitIndex {
		
		lastLogIndex := len(n.Log.Entries)
		if req.LeaderCommit < lastLogIndex {
			n.CommitIndex = req.LeaderCommit
		} else {
			n.CommitIndex = lastLogIndex
		}
		n.Logger.Printf("term=%d state=%s event=commit_index_updated newCommitIndex=%d",
			n.CurrentTerm, n.State.String(), n.CommitIndex)
	}

	response.Success = true
	response.LogLength = len(n.Log.Entries)
	return response
}












func (n *Node) HandleSyncLog(req SyncLogRequest) SyncLogResponse {
	n.Mu.Lock()
	defer n.Mu.Unlock()

	response := SyncLogResponse{
		Success:    false,
		SyncedUpTo: 0,
	}

	
	if req.FromIndex == 0 {
		n.Log.Mu.Lock()
		n.Log.Entries = make([]LogEntry, 0)
		n.Log.Mu.Unlock()
	}

	
	for _, entry := range req.Entries {
		n.Log.Append(entry)
	}

	
	if len(req.Entries) > 0 {
		lastEntry := req.Entries[len(req.Entries)-1]
		n.CommitIndex = lastEntry.Index
		response.SyncedUpTo = lastEntry.Index
	}

	response.Success = true

	n.Logger.Printf("term=%d state=%s event=sync_log_received entriesCount=%d syncedUpTo=%d",
		n.CurrentTerm, n.State.String(), len(req.Entries), response.SyncedUpTo)

	return response
}













func (n *Node) ReplicateEntry(stroke Stroke) (bool, error) {
	n.Mu.Lock()

	
	if n.State != Leader {
		n.Mu.Unlock()
		return false, fmt.Errorf("not the leader")
	}

	
	lastLogIndex, _ := n.Log.GetLastLogIndexAndTerm()
	newEntry := LogEntry{
		Index:  lastLogIndex + 1,
		Term:   n.CurrentTerm,
		Stroke: stroke,
	}

	
	n.Log.Append(newEntry)
	n.Logger.Printf("term=%d state=LEADER event=entry_appended index=%d", n.CurrentTerm, newEntry.Index)

	
	currentTerm := n.CurrentTerm
	leaderId := n.ID
	leaderCommit := n.CommitIndex
	peers := make([]string, len(n.PeerURLs))
	copy(peers, n.PeerURLs)

	
	for _, peer := range peers {
		
		if n.LeaderState != nil {
			n.LeaderState.NextIndex[peer] = newEntry.Index + 1
		}
	}

	n.Mu.Unlock()

	
	var wg sync.WaitGroup
	var successMu sync.Mutex
	successCount := 1 

	for _, peerURL := range peers {
		wg.Add(1)
		go func(url string) {
			defer wg.Done()

			
			n.Mu.Lock()
			prevLogIndex := newEntry.Index - 1
			prevLogTerm := 0
			if prevLogIndex > 0 && prevLogIndex <= len(n.Log.Entries) {
				prevLogTerm = n.Log.Entries[prevLogIndex-1].Term
			}
			n.Mu.Unlock()

			req := AppendEntriesRequest{
				Term:         currentTerm,
				LeaderId:     leaderId,
				PrevLogIndex: prevLogIndex,
				PrevLogTerm:  prevLogTerm,
				Entries:      []LogEntry{newEntry},
				LeaderCommit: leaderCommit,
			}

			resp, err := n.sendAppendEntries(url, req)
			if err != nil {
				n.Logger.Printf("term=%d state=LEADER event=replication_failed peer=%s error=%v",
					currentTerm, url, err)
				return
			}

			
			n.Mu.Lock()
			if resp.Term > n.CurrentTerm {
				n.BecomeFollower(resp.Term)
				n.Mu.Unlock()
				return
			}
			n.Mu.Unlock()

			if resp.Success {
				successMu.Lock()
				successCount++
				successMu.Unlock()

				
				n.Mu.Lock()
				if n.LeaderState != nil {
					n.LeaderState.MatchIndex[url] = newEntry.Index
				}
				n.Mu.Unlock()
			} else {
				
				
				n.Logger.Printf("term=%d state=LEADER event=replication_rejected peer=%s logLength=%d",
					currentTerm, url, resp.LogLength)

				
				go n.syncFollowerLog(url, currentTerm)
			}
		}(peerURL)
	}

	wg.Wait()

	
	majority := (len(peers)+1)/2 + 1
	committed := successCount >= majority

	if committed {
		
		n.Mu.Lock()
		if n.State == Leader && n.CurrentTerm == currentTerm {
			n.CommitIndex = newEntry.Index
			n.Logger.Printf("term=%d state=LEADER event=entry_committed index=%d", currentTerm, newEntry.Index)
		}
		n.Mu.Unlock()
	}

	return committed, nil
}



func (n *Node) syncFollowerLog(peerURL string, leaderTerm int) {
	n.Mu.Lock()
	if n.State != Leader || n.CurrentTerm != leaderTerm {
		n.Mu.Unlock()
		return
	}

	
	entries := make([]LogEntry, len(n.Log.Entries))
	copy(entries, n.Log.Entries)
	n.Mu.Unlock()

	req := SyncLogRequest{
		FromIndex: 0,
		Entries:   entries,
	}

	resp, err := n.sendSyncLog(peerURL, req)
	if err != nil {
		n.Logger.Printf("term=%d state=LEADER event=sync_log_failed peer=%s error=%v",
			leaderTerm, peerURL, err)
		return
	}

	if resp.Success {
		n.Logger.Printf("term=%d state=LEADER event=sync_log_sent peer=%s syncedUpTo=%d",
			leaderTerm, peerURL, resp.SyncedUpTo)

		
		n.Mu.Lock()
		if n.LeaderState != nil {
			n.LeaderState.MatchIndex[peerURL] = resp.SyncedUpTo
			n.LeaderState.NextIndex[peerURL] = resp.SyncedUpTo + 1
		}
		n.Mu.Unlock()
	}
}






func (n *Node) sendHeartbeat(peerURL string, req HeartbeatRequest) (*HeartbeatResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	client := &http.Client{Timeout: 100 * time.Millisecond}
	url := peerURL + "/heartbeat"
	resp, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to send request to %s: %w", url, err)
	}
	defer resp.Body.Close()

	var response HeartbeatResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &response, nil
}


func (n *Node) sendAppendEntries(peerURL string, req AppendEntriesRequest) (*AppendEntriesResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	client := &http.Client{Timeout: 500 * time.Millisecond}
	url := peerURL + "/append-entries"
	resp, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to send request to %s: %w", url, err)
	}
	defer resp.Body.Close()

	var response AppendEntriesResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &response, nil
}


func (n *Node) sendSyncLog(peerURL string, req SyncLogRequest) (*SyncLogResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	client := &http.Client{Timeout: 5 * time.Second} 
	url := peerURL + "/sync-log"
	resp, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to send request to %s: %w", url, err)
	}
	defer resp.Body.Close()

	var response SyncLogResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &response, nil
}
