// Scenario import/export — stores a raw JSON scenario blob
let scenarioBlob: Record<string, unknown> | null = null;

export async function GET() {
  return scenarioBlob;
}

export async function POST(body: Record<string, unknown>) {
  scenarioBlob = body;
  return { success: true };
}

export async function DELETE() {
  scenarioBlob = null;
  return { success: true };
}
