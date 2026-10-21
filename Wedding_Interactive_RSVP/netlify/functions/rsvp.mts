import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { rsvps } from "../../db/schema.js";

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: { name?: unknown; attending?: unknown; guests?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const attending = body.attending === true;
  const guests = attending ? Math.floor(Number(body.guests)) : 0;

  if (!name) {
    return Response.json({ error: "Please tell us your name." }, { status: 400 });
  }
  if (attending && (!Number.isFinite(guests) || guests < 1 || guests > 30)) {
    return Response.json({ error: "Please enter between 1 and 30 guests." }, { status: 400 });
  }

  const [saved] = await db
    .insert(rsvps)
    .values({ name, attending, guests })
    .returning({ id: rsvps.id });

  return Response.json({ ok: true, id: saved.id }, { status: 201 });
};

export const config: Config = {
  path: "/api/rsvp",
};
