package main

import (
	"fmt"
	"log"
	"math/rand"
	"os"
	"strings"
	"time"

	"miniraft/replica/handlers"
	"miniraft/replica/raft"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
)

func main() {
	rand.Seed(time.Now().UnixNano())
	replicaID := os.Getenv("REPLICA_ID")
	if replicaID == "" {
		log.Fatal("REPLICA_ID environment variable is required")
	}

	port := os.Getenv("PORT")
	if port == "" {
		log.Fatal("PORT environment variable is required")
	}

	peersEnv := os.Getenv("PEERS")
	if peersEnv == "" {
		log.Fatal("PEERS environment variable is required")
	}

	peers := strings.Split(peersEnv, ",")
	for i, peer := range peers {
		peers[i] = strings.TrimSpace(peer)
	}

	customLogger := log.New(os.Stdout, fmt.Sprintf("[%s] ", replicaID), log.LstdFlags)

	customLogger.Printf("Starting RAFT replica...")
	customLogger.Printf("  ID:    %s", replicaID)
	customLogger.Printf("  Port:  %s", port)
	customLogger.Printf("  Peers: %v", peers)

	node := raft.NewNode(replicaID, peers, customLogger)

	customLogger.Printf("term=%d state=%s event=node_initialized", node.CurrentTerm, node.State)

	go node.RunElectionTimer()

	customLogger.Printf("term=%d state=%s event=election_timer_started", node.CurrentTerm, node.State)

	app := fiber.New(fiber.Config{
		DisableStartupMessage: true,
		ReadTimeout:           10 * time.Second,
		WriteTimeout:          10 * time.Second,
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,PUT,DELETE,OPTIONS",
		AllowHeaders: "Content-Type,Authorization",
	}))

	app.Use(logger.New(logger.Config{
		Format:     fmt.Sprintf("[%s] ${time} | ${status} | ${latency} | ${method} ${path}\n", replicaID),
		TimeFormat: "2006/01/02 15:04:05",
	}))

	rpcHandler := handlers.NewRPCHandler(node)
	rpcHandler.RegisterRoutes(app)

	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":    "ok",
			"replicaId": replicaID,
		})
	})

	listenAddr := fmt.Sprintf(":%s", port)
	customLogger.Printf("term=%d state=%s event=server_starting addr=%s", node.CurrentTerm, node.State, listenAddr)

	if err := app.Listen(listenAddr); err != nil {
		customLogger.Fatalf("Failed to start server: %v", err)
	}
}
