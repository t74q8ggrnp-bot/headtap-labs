"use client";

import { motion } from "framer-motion";

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white overflow-hidden">
      <section className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <motion.img
          src="/logo.png"
          alt="HeadTap Labs Logo"
          className="w-32 h-32 mb-8"
          initial={{ opacity: 0, scale: 0.7, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />

        <motion.h1
          className="text-5xl md:text-7xl font-bold tracking-tight mb-6"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          HeadTap Labs
        </motion.h1>

        <motion.p
          className="max-w-2xl text-lg md:text-xl text-white/70 mb-10"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          AI-powered tools for sharper product research, smarter pricing,
          and faster decision-making.
        </motion.p>

        <motion.button
          className="rounded-full bg-white text-black px-8 py-4 font-semibold text-lg"
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
        >
          Start Analyzing
        </motion.button>
      </section>

      <section className="px-6 py-24 max-w-6xl mx-auto grid md:grid-cols-3 gap-6">
        {[
          {
            title: "AI Product Analysis",
            text: "Break down products, pricing, demand signals, and positioning in seconds.",
          },
          {
            title: "Market Insights",
            text: "Spot trends, compare competitors, and understand where your product fits.",
          },
          {
            title: "Smarter Decisions",
            text: "Turn messy research into clear, useful direction for your next move.",
          },
        ].map((card, index) => (
          <motion.div
            key={card.title}
            className="rounded-3xl border border-white/10 bg-white/5 p-8"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            whileHover={{ y: -8, scale: 1.02 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: index * 0.15 }}
          >
            <h2 className="text-2xl font-bold mb-4">{card.title}</h2>
            <p className="text-white/65">{card.text}</p>
          </motion.div>
        ))}
      </section>
    </main>
  );
}