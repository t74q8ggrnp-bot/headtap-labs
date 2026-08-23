import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  ACCOUNT_USER_DATA_TABLES,
  isConfirmedAccountDeletion,
  isMissingPersonalDataTable,
  readBearerToken,
} from "@/lib/account-deletion";

export const dynamic = "force-dynamic";

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function getSupabaseCredentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = (
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();

  if (!url || !anonKey || !serviceKey) {
    throw new Error("Account deletion is not configured.");
  }

  return { url, anonKey, serviceKey };
}

export async function DELETE(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response({ ok: false, error: "Invalid request." }, 400);
  }

  if (!isConfirmedAccountDeletion(body)) {
    return response({ ok: false, error: "Deletion was not confirmed." }, 400);
  }

  const accessToken = readBearerToken(request.headers.get("authorization"));
  if (!accessToken) {
    return response({ ok: false, error: "Authentication required." }, 401);
  }

  try {
    const { url, anonKey, serviceKey } = getSupabaseCredentials();
    const authClient = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { data: authData, error: authError } =
      await authClient.auth.getUser(accessToken);

    if (authError || !authData.user) {
      return response({ ok: false, error: "Authentication expired. Sign in again." }, 401);
    }

    const serviceClient = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    for (const table of ACCOUNT_USER_DATA_TABLES) {
      const { error } = await serviceClient
        .from(table)
        .delete()
        .eq("user_id", authData.user.id);

      // A table that has never been provisioned cannot contain user data.
      // Every other error stops the process before the Auth user is removed,
      // allowing the user to retry without leaving unreachable personal rows.
      if (error && !isMissingPersonalDataTable(error.code)) {
        console.error("[account-delete] personal-data removal failed", {
          table,
          code: error.code,
        });
        return response(
          { ok: false, error: "Account data could not be fully removed. Please try again." },
          500,
        );
      }
    }

    const { error: deleteUserError } =
      await serviceClient.auth.admin.deleteUser(authData.user.id);
    if (deleteUserError) {
      console.error("[account-delete] auth removal failed", {
        code: deleteUserError.code,
      });
      return response(
        { ok: false, error: "Account authentication could not be removed. Please try again." },
        500,
      );
    }

    return response({ ok: true }, 200);
  } catch (error) {
    console.error("[account-delete] unexpected failure", {
      message: error instanceof Error ? error.message : "Unknown failure",
    });
    return response(
      { ok: false, error: "Account deletion is temporarily unavailable." },
      503,
    );
  }
}
