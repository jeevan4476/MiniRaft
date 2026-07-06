package handlers

import (
	"miniraft/replica/raft"

	"github.com/gofiber/fiber/v2"
)

type RPCHandler struct {
	Node *raft.Node
}

func NewRPCHandler(node *raft.Node) *RPCHandler {
	return &RPCHandler{Node: node}
}
func (h *RPCHandler) HandleRequestVote(c *fiber.Ctx) error {
	var req raft.RequestVoteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body: " + err.Error(),
		})
	}

	resp := h.Node.HandleRequestVote(req)

	return c.JSON(resp)
}
func (h *RPCHandler) HandleAppendEntries(c *fiber.Ctx) error {
	var req raft.AppendEntriesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body: " + err.Error(),
		})
	}

	resp := h.Node.HandleAppendEntries(req)

	return c.JSON(resp)
}
func (h *RPCHandler) HandleHeartbeat(c *fiber.Ctx) error {
	var req raft.HeartbeatRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body: " + err.Error(),
		})
	}

	resp := h.Node.HandleHeartbeat(req)

	return c.JSON(resp)
}
func (h *RPCHandler) HandleSyncLog(c *fiber.Ctx) error {
	var req raft.SyncLogRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body: " + err.Error(),
		})
	}

	resp := h.Node.HandleSyncLog(req)

	return c.JSON(resp)
}
func (h *RPCHandler) HandleStatus(c *fiber.Ctx) error {
	h.Node.Mu.Lock()
	defer h.Node.Mu.Unlock()

	status := fiber.Map{
		"replicaId":   h.Node.ID,
		"state":       h.Node.State.String(),
		"term":        h.Node.CurrentTerm,
		"commitIndex": h.Node.CommitIndex,
		"logLength":   len(h.Node.Log.Entries),
	}

	return c.JSON(status)
}
func (h *RPCHandler) HandleStroke(c *fiber.Ctx) error {
	var stroke raft.Stroke
	if err := c.BodyParser(&stroke); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body: " + err.Error(),
		})
	}

	committed, err := h.Node.ReplicateEntry(stroke)
	if err != nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"success": false,
			"error":   err.Error(),
		})
	}

	h.Node.Mu.Lock()
	logLength := len(h.Node.Log.Entries)
	h.Node.Mu.Unlock()

	return c.JSON(fiber.Map{
		"success":   true,
		"committed": committed,
		"index":     logLength,
	})
}
func (h *RPCHandler) HandleGetLog(c *fiber.Ctx) error {
	h.Node.Mu.Lock()
	defer h.Node.Mu.Unlock()

	entries := make([]raft.LogEntry, len(h.Node.Log.Entries))
	copy(entries, h.Node.Log.Entries)

	return c.JSON(fiber.Map{
		"entries":     entries,
		"commitIndex": h.Node.CommitIndex,
		"length":      len(entries),
	})
}
func (h *RPCHandler) RegisterRoutes(app *fiber.App) {
	app.Post("/request-vote", h.HandleRequestVote)
	app.Post("/append-entries", h.HandleAppendEntries)
	app.Post("/heartbeat", h.HandleHeartbeat)
	app.Post("/sync-log", h.HandleSyncLog)

	app.Get("/status", h.HandleStatus)

	app.Post("/stroke", h.HandleStroke)

	app.Get("/log", h.HandleGetLog)
}
