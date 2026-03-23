import type { LeaderTracker } from "./leader"
import { StrokeSchema } from "./types";
import type { WSEvents } from "hono/ws";

export function setupWebSocket(tracker: LeaderTracker): WSEvents {
    return {
        onOpen(evt, ws) {
            // @ts-ignore - Bun extends the standard WS Context with subscribe
            ws.subscribe("strokes");

            const leaderUrl = tracker.getLeaderUrl();
            if (!leaderUrl) return;

            fetch(leaderUrl + "/log").then(res => res.json()).then((data: any) => {

                ws.send(JSON.stringify({ type: 'history', strokes: data.entries }));
            }).catch(err => console.error("Failed to fetch history", err));
        },

        async onMessage(evt, ws) {
            try {
                // evt.data is usually a string or Buffer. We cast to string for JSON parsing.
                const payload = JSON.parse(evt.data as string);
                if (payload.type !== "stroke") return;

                // Zod validation prevents bad data from ever hitting the Go backend
                const validStroke = StrokeSchema.parse(payload.stroke);
                const leaderUrl = tracker.getLeaderUrl();
                if (!leaderUrl) return;
                fetch(leaderUrl + "/stroke", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(validStroke),
                }).then(res => res.json()).then((data: any) => {
                    if (data.committed) {
                        // Publish beams the validated stroke to every connected browser in the 'strokes' room
                        // @ts-ignore - Bun extends the standard WS Context with publish
                        ws.publish("strokes", JSON.stringify({ type: 'stroke', stroke: validStroke }));
                    }
                }).catch(err => console.error("Failed to append stroke", err));
            } catch (error) {
                console.error("Failed to parse stroke", error);
            }
        },
        onClose(evt, ws) {
            // @ts-ignore
            ws.unsubscribe("strokes");
        }
    }
}
