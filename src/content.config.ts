import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { stages } from './lib/stages';

const garden = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/garden' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    stage: z.enum(stages),
    /** Map position in pixels from the field's center; positive y is down. */
    x: z.number(),
    y: z.number(),
    description: z.string().optional(),
  }),
});

export const collections = { garden };
