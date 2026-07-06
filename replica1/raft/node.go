package raft

import (
	"log"
	"math/rand"
	"sync"
	"time"
)

type State int

const (
	Follower State = iota
	Candidate
	Leader
)

func (s State) String() string {
	switch s {
	case Follower:
		return "FOLLOWER"
	case Candidate:
		return "CANDIDATE"
	case Leader:
		return "LEADER"
	default:
		return "UNKNOWN"
	}
}

type Node struct {
	Mu          sync.RWMutex
	ID          string
	PeerURLs    []string
	Logger      *log.Logger
	CurrentTerm int
	VotedFor    string
	Log         *LogManager
	CommitIndex int
	LastApplied int
	State       State
	LeaderState *LeaderState

	lastHeartbeat time.Time
	electionTimer *time.Timer
}

func NewNode(id string, peers []string, logger *log.Logger) *Node {
	n := &Node{
		ID:          id,
		PeerURLs:    peers,
		Logger:      logger,
		State:       Follower,
		CurrentTerm: 0,
		VotedFor:    "",
		Log:         &LogManager{Entries: make([]LogEntry, 0)},
		CommitIndex: 0,
		LastApplied: 0,
	}

	n.lastHeartbeat = time.Now()
	r := n.RandomElectionTimeout()
	n.electionTimer = time.NewTimer(r)
	n.Logger.Print("Election timeout to start the election: ", r)
	return n
}
func (n *Node) RandomElectionTimeout() time.Duration {
	r := rand.Float64()
	timeoutMs := 500.0 + (r * 300.0)
	return time.Duration(timeoutMs) * time.Millisecond
}
func (n *Node) BecomeFollower(newTerm int) {
	n.State = Follower
	n.CurrentTerm = newTerm
	n.VotedFor = ""
	n.lastHeartbeat = time.Now()
	n.Logger.Printf("term=%d state=FOLLOWER event=stepped_down", n.CurrentTerm)
}
