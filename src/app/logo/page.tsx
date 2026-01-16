"use client";

import { Logo } from "@/components/ui/Logo";

export default function LogoPage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top half: Dark background with white logo */}
      <div className="flex-1 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 flex items-center justify-center">
        <Logo
          textClassName="text-[20rem] leading-none"
          taglineClassName="text-[2.3rem] tracking-[0.3em] -mt-[3rem] pl-[0.6em]"
          showTagline
        />
      </div>

      {/* Bottom half: White background with gradient logo */}
      <div className="flex-1 bg-white flex items-center justify-center">
        <div className="inline-flex flex-col items-center">
          <span
            className="text-[20rem] leading-none font-bold bg-gradient-to-br from-slate-900 via-slate-700 to-indigo-900 bg-clip-text text-transparent"
            style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
          >
            MODAL
          </span>
          <span
            className="text-[2.3rem] tracking-[0.3em] -mt-[3rem] pl-[0.6em] uppercase text-center bg-gradient-to-br from-slate-900 via-slate-700 to-indigo-900 bg-clip-text text-transparent"
            style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
          >
            Capture. Connect. Understand.
          </span>
        </div>
      </div>
    </div>
  );
}
