import { NextResponse } from "next/server";
import { getSheetData } from "../../lib/sheets";

export async function GET() {
  try {
    const data = await getSheetData();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Error fetching Google Sheets data:", err);
    return NextResponse.json(
      { error: "Failed to fetch data", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}