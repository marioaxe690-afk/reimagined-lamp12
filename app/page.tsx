"use client";

import { motion } from "framer-motion";
import { AppOverlayHost } from "@/components/AppOverlayHost";
import { FreezeReturnScheduler } from "@/components/FreezeReturnScheduler";
import { TopModeTabs } from "@/components/TopModeTabs";
import { DeckLibrary } from "@/components/deck/DeckLibrary";
import { InputComposer } from "@/components/input/InputComposer";
import { ProofDashboard } from "@/components/proof/ProofDashboard";
import { useNextCardStore } from "@/store/useNextCardStore";

export default function Home() {
  const { mode, setMode } = useNextCardStore();
  const changeMode = (nextMode: typeof mode) => {
    setMode(nextMode);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  return (
    <main className="webview-root">
      <div className="webview-frame">
        <TopModeTabs activeMode={mode} onChange={changeMode} />

        {mode === "input" && (
          <motion.div
            key="input"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="webview-stack"
          >
            <InputComposer />
          </motion.div>
        )}

        {mode === "deck" && (
          <motion.div key="deck" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="min-h-0 flex-1 overflow-hidden">
            <DeckLibrary />
          </motion.div>
        )}

        {mode === "proof" && (
          <motion.div key="proof" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="min-h-0 flex-1">
            <ProofDashboard />
          </motion.div>
        )}
      </div>
      <AppOverlayHost />
      <FreezeReturnScheduler />
    </main>
  );
}
