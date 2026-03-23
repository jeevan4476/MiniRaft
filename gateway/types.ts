import * as z from "zod";

//schema builder for validatiing plain js objects 
// when we call parse() it will validate the object and return the object
// if the object is not valid it will throw an error
export const StrokeSchema = z.object({
    x0: z.number(),
    y0: z.number(),
    x1: z.number(),
    y1: z.number(),
    color: z.string(),
    width: z.number(),
})

// extracting static typescript type from this zod schema 
//soo that we can use this schema inferred type directly inside the typescript file.
//basically we are making sure all the tyoes are in sync everywhere
export type Stroke = z.infer<typeof StrokeSchema>


export type NodeStatus = {
    replicaId: string;
    state: string;
    term: number;
    commitIndex: number;
    logLength: number;
}

