import { handleApiRequest } from "../../../server/api.js";
import { getService } from "../../../server/runtime.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function route(request: Request) {
	return (
		(await handleApiRequest(getService(), request)) ??
		Response.json({ error: "Not found" }, { status: 404 })
	);
}

export const GET = route;
export const POST = route;
export const PUT = route;
export const DELETE = route;
export const OPTIONS = route;
