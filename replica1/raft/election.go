package raft

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type RequestVoteRequest struct {
	Term         int    `json:"term"`
	CandidateId  string `json:"candidateId"`
	LastLogIndex int    `json:"lastLogIndex"`
	LastLogTerm  int    `json:"lastLogTerm"`
}
type RequestVoteResponse struct {
	Term        int  `json:"term"`
	VoteGranted bool `json:"voteGranted"`
}

func (n *Node) RunElectionTimer() {
	for {
		<-n.electionTimer.C
		n.Mu.Lock()
		if n.State == Leader {
			n.electionTimer.Reset(n.RandomElectionTimeout())
			n.Mu.Unlock()
			continue
		}

		n.Logger.Printf("term=%d state=%s event=election_timeout", n.CurrentTerm, n.State)
		n.Mu.Unlock()

		n.StartElection()
	}
}
func (n *Node) StartElection() {
	n.Mu.Lock()
	n.CurrentTerm++
	n.State = Candidate
	n.VotedFor = n.ID
	currentTerm := n.CurrentTerm
	candidateId := n.ID
	lastLogIndex, lastLogTerm := n.Log.GetLastLogIndexAndTerm()
	n.electionTimer.Reset(n.RandomElectionTimeout())
	peers := make([]string, len(n.PeerURLs))
	copy(peers, n.PeerURLs)

	n.Logger.Printf("term=%d state=CANDIDATE event=election_started lastLogIndex=%d lastLogTerm=%d",
		currentTerm, lastLogIndex, lastLogTerm)

	n.Mu.Unlock()

	var wg sync.WaitGroup
	var votesMu sync.Mutex
	votesReceived := 1

	for _, peerURL := range peers {
		wg.Add(1)
		go func(url string) {
			defer wg.Done()

			req := RequestVoteRequest{
				Term:         currentTerm,
				CandidateId:  candidateId,
				LastLogIndex: lastLogIndex,
				LastLogTerm:  lastLogTerm,
			}

			resp, err := n.sendRequestVote(url, req)
			if err != nil {
				n.Logger.Printf("term=%d state=CANDIDATE event=vote_request_failed peer=%s error=%v",
					currentTerm, url, err)
				return
			}

			n.Mu.Lock()
			if resp.Term > n.CurrentTerm {
				n.Logger.Printf("term=%d state=CANDIDATE event=higher_term_discovered newTerm=%d",
					n.CurrentTerm, resp.Term)
				n.BecomeFollower(resp.Term)
				n.Mu.Unlock()
				return
			}

			
			
			if n.State != Candidate || n.CurrentTerm != currentTerm {
				n.Mu.Unlock()
				return
			}
			n.Mu.Unlock()

			if resp.VoteGranted {
				votesMu.Lock()
				votesReceived++
				currentVotes := votesReceived
				votesMu.Unlock()

				n.Logger.Printf("term=%d state=CANDIDATE event=vote_granted from=%s votes=%d",
					currentTerm, url, currentVotes)

				majority := (len(peers)+1)/2 + 1
				if currentVotes >= majority {
					n.Mu.Lock()
					if n.State == Candidate && n.CurrentTerm == currentTerm {
						n.BecomeLeader()
					}
					n.Mu.Unlock()
				}
			} else {
				n.Logger.Printf("term=%d state=CANDIDATE event=vote_denied from=%s", currentTerm, url)
			}
		}(peerURL)
	}

	wg.Wait()
}
func (n *Node) BecomeLeader() {
	n.State = Leader

	n.Logger.Printf("term=%d state=LEADER event=election_won", n.CurrentTerm)

	go n.RunHeartbeatLoop()
}
func (n *Node) HandleRequestVote(req RequestVoteRequest) RequestVoteResponse {
	n.Mu.Lock()
	defer n.Mu.Unlock()

	response := RequestVoteResponse{
		Term:        n.CurrentTerm,
		VoteGranted: false,
	}

	if req.Term < n.CurrentTerm {
		n.Logger.Printf("term=%d state=%s event=vote_denied reason=stale_term candidateTerm=%d candidate=%s",
			n.CurrentTerm, n.State.String(), req.Term, req.CandidateId)
		return response
	}

	if req.Term > n.CurrentTerm {
		n.Logger.Printf("term=%d state=%s event=higher_term_discovered newTerm=%d",
			n.CurrentTerm, n.State.String(), req.Term)
		n.BecomeFollower(req.Term)
		response.Term = n.CurrentTerm
	}

	canVote := n.VotedFor == "" || n.VotedFor == req.CandidateId

	if !canVote {
		n.Logger.Printf("term=%d state=%s event=vote_denied reason=already_voted votedFor=%s candidate=%s",
			n.CurrentTerm, n.State.String(), n.VotedFor, req.CandidateId)
		return response
	}

	ourLastLogIndex, ourLastLogTerm := n.Log.GetLastLogIndexAndTerm()
	candidateLogUpToDate := n.isLogUpToDate(req.LastLogTerm, req.LastLogIndex, ourLastLogTerm, ourLastLogIndex)

	if !candidateLogUpToDate {
		n.Logger.Printf("term=%d state=%s event=vote_denied reason=log_not_up_to_date candidate=%s "+
			"candidateLastLogTerm=%d candidateLastLogIndex=%d ourLastLogTerm=%d ourLastLogIndex=%d",
			n.CurrentTerm, n.State.String(), req.CandidateId,
			req.LastLogTerm, req.LastLogIndex, ourLastLogTerm, ourLastLogIndex)
		return response
	}

	n.VotedFor = req.CandidateId
	response.VoteGranted = true

	n.electionTimer.Reset(n.RandomElectionTimeout())
	n.lastHeartbeat = time.Now()

	n.Logger.Printf("term=%d state=%s event=vote_granted for=%s",
		n.CurrentTerm, n.State.String(), req.CandidateId)

	return response
}
func (n *Node) isLogUpToDate(candidateLastTerm, candidateLastIndex, ourLastTerm, ourLastIndex int) bool {
	if candidateLastTerm > ourLastTerm {
		return true
	}
	if candidateLastTerm == ourLastTerm && candidateLastIndex >= ourLastIndex {
		return true
	}
	return false
}
func (n *Node) sendRequestVote(peerURL string, req RequestVoteRequest) (*RequestVoteResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	client := &http.Client{
		Timeout: 200 * time.Millisecond,
	}

	url := peerURL + "/request-vote"
	resp, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to send request to %s: %w", url, err)
	}
	defer resp.Body.Close()

	
	var response RequestVoteResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return nil, fmt.Errorf("failed to decode response from %s: %w", url, err)
	}

	return &response, nil
}
func (n *Node) ResetElectionTimer() {
	if !n.electionTimer.Stop() {
		select {
		case <-n.electionTimer.C:
		default:
		}
	}
	r := n.RandomElectionTimeout()
	n.Logger.Print("Reseting Election timeout: ", r)
	n.electionTimer.Reset(r)
	n.lastHeartbeat = time.Now()
}
