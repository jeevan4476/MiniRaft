import type { NodeStatus } from "./types";

export class LeaderTracker {
    private leaderId: string | null = null;
    private leaderUrl: string | null = null;
    private term: number = 0;
    private peers: string[] = [];

    constructor(peers: string[]) {
        this.peers = peers;
    }

    async startPolling() {
        setInterval(async () => {
            // Fire off requests to all peers at the exact same time
            this.peers.forEach(async (peer) => {
                try {
                    const res = await fetch(peer + "/status", { signal: AbortSignal.timeout(500) });
                    if (!res.ok) return;
                    const status = await res.json() as NodeStatus;
                    if (status.state === "LEADER") {
                        this.leaderId = status.replicaId;
                        this.leaderUrl = peer;
                        this.term = status.term;
                        console.log(`[Gateway] Found Leader: ${peer} (Term ${status.term})`);
                    }
                } catch (error) {
                    // Ignore offline nodes quietly to prevent console spam
                }
            })
        }, 2000);
    }

    getLeaderUrl(): string | null {
        return this.leaderUrl;
    }
}