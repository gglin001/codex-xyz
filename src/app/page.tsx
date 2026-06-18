import { App } from "../client/App.js";
import { getService } from "../server/runtime.js";

export const dynamic = "force-dynamic";

export default function Page() {
  const initialState = getService().dashboard();
  return <App initialState={initialState} />;
}
