package raft

import "sync"

type Stroke struct {
	X0    float64 `json:"x0"`
	Y0    float64 `json:"y0"`
	X1    float64 `json:"x1"`
	Y1    float64 `json:"y1"`
	Color string  `json:"color"`
	Width float64 `json:"width"`
}
type LogEntry struct {
	Index  int    `json:"index"`
	Term   int    `json:"term"`
	Stroke Stroke `json:"stroke"`
}
type LogManager struct {
	Mu      sync.RWMutex
	Entries []LogEntry
}

func (lm *LogManager) GetLastLogIndexAndTerm() (int, int) {
	lm.Mu.RLock()
	defer lm.Mu.RUnlock()

	if len(lm.Entries) == 0 {
		return 0, 0
	}
	lastEntry := lm.Entries[len(lm.Entries)-1]
	return lastEntry.Index, lastEntry.Term
}
func (lm *LogManager) Append(entry LogEntry) {
	lm.Mu.Lock()
	defer lm.Mu.Unlock()
	lm.Entries = append(lm.Entries, entry)
}
