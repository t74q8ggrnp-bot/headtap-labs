import { Suspense } from "react";
import HomeClient from "./HomeClient";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeClient
        surface="intelligence"
        initialMomentumPayload={null}
        initialBeforeCrowdPayload={null}
      />
    </Suspense>
  );
}
