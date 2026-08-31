import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import IngestInbox from "./IngestInbox";

// /admin/emails — the ingest inbox.
//
// Every message Postmark has delivered, what the pipeline decided about it,
// and why. Three jobs:
//   1. Diagnose format drift in seconds instead of querying SQL during market
//      hours.
//   2. Approve quarantined mail (one tap hands it back to the pipeline).
//   3. Read Gmail's forwarding-confirmation code during setup — it arrives
//      here like any other message.
//
// Gated the same way as /admin/pitch: unknown callers get a 404 rather than a
// 403, so the route's existence is not advertised.

export default async function AdminEmailsPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();

  return <IngestInbox />;
}
