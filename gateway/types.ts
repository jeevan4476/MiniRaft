import * as z from "zod";

export const StrokeSchema = z.object({
    x0: z.number(),
    y0: z.number(),
    x1: z.number(),
    y1: z.number(),
    color: z.string(),
    width: z.number(),
})

export type Stroke = z.infer<typeof StrokeSchema>

export type NodeStatus = {
    replicaId: string;
    state: string;
    term: number;
    commitIndex: number;
    logLength: number;
}

