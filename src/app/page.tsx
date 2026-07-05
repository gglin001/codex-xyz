import { App } from "../client/App.js";
import { getService } from "../server/runtime.js";

export const dynamic = "force-dynamic";

export default async function Page() {
	const initialState = await getService().dashboard();
	return <App initialState={initialState} />;
}
