import { DurableObject } from "cloudflare:workers"

const RUNNING_STATE_KEY = "isRunning"

export class StartStopControlDurableObject extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const isRunning = await this.readRunningState()

    if (url.pathname === "/status" && request.method === "GET") {
      return Response.json({ isRunning })
    }

    if (url.pathname === "/start" && request.method === "POST") {
      await this.ctx.storage.put(RUNNING_STATE_KEY, true)
      return Response.json({ isRunning: true })
    }

    if (url.pathname === "/stop" && request.method === "POST") {
      await this.ctx.storage.put(RUNNING_STATE_KEY, false)
      return Response.json({ isRunning: false })
    }

    return new Response("Not found", { status: 404 })
  }

  private async readRunningState(): Promise<boolean> {
    const current = await this.ctx.storage.get<boolean>(RUNNING_STATE_KEY)
    return current ?? true
  }
}
