CREATE TABLE "rsvps" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"attending" boolean NOT NULL,
	"guests" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
