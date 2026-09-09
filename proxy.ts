import { NextResponse } from "next/server";
import { isCryptoCapabilityEnabled } from "@/lib/crypto/product-capabilities";

export function proxy() {
  if (!isCryptoCapabilityEnabled("publicUiEnabled")) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/crypto/:path*", "/paper/crypto/:path*"],
};
