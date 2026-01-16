"use client";

import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Mail, User, CheckCircle2, XCircle, Loader2, ArrowLeft, ArrowRight,
  Send, Plus, Trash2, Settings, Save, Edit, X, Search,
  Sparkles, Target, TrendingUp, Play, Pause, Filter, Copy,
  Bell, Heart, Star, Shield, Lock, Unlock, Eye, EyeOff,
  Download, Upload, Share2, Link2, ExternalLink, MoreHorizontal,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Info, AlertTriangle, AlertCircle, HelpCircle
} from "lucide-react";

// Note: Pour empêcher l'indexation, ajouter dans layout.tsx ou via robots.txt
// Cette page est une documentation interne de design

export default function LogoPage() {
  return (
    <div className="flex flex-col">
      {/* ============================================ */}
      {/* SECTION 1: Logo on Dark Background + Aurora */}
      {/* ============================================ */}
      <div className="min-h-screen relative overflow-hidden flex items-center justify-center">
        <div className="absolute inset-0 bg-[#0B1120]">
          <div className="aurora-layer aurora-cyan" />
          <div className="aurora-layer aurora-pink" />
        </div>
        <div className="relative z-10">
          <Logo
            textClassName="text-[20rem] leading-none"
            taglineClassName="text-[2.3rem] tracking-[0.3em] -mt-[3rem] pl-[0.6em]"
            showTagline
          />
        </div>
      </div>

      {/* ============================================ */}
      {/* SECTION 2: Logo Animated Aurora Gradient on White */}
      {/* ============================================ */}
      <div className="min-h-screen bg-white flex items-center justify-center relative overflow-hidden">
        <div className="inline-flex flex-col items-center relative">
          <span
            className="text-[20rem] leading-none font-bold bg-clip-text text-transparent animate-aurora-text"
            style={{
              fontFamily: "'Saira Extra Condensed', sans-serif",
              backgroundImage: "linear-gradient(135deg, #0B1120 0%, #1e3a5f 25%, #0d9488 50%, #c026d3 75%, #0B1120 100%)",
              backgroundSize: "300% 300%",
            }}
          >
            MODAL
          </span>
          <span
            className="text-[2.3rem] tracking-[0.3em] -mt-[3rem] pl-[0.6em] uppercase text-center bg-clip-text text-transparent animate-aurora-text"
            style={{
              fontFamily: "'Saira Extra Condensed', sans-serif",
              backgroundImage: "linear-gradient(135deg, #0B1120 0%, #1e3a5f 25%, #0d9488 50%, #c026d3 75%, #0B1120 100%)",
              backgroundSize: "300% 300%",
            }}
          >
            Capture. Connect. Understand.
          </span>
        </div>
      </div>

      {/* ============================================ */}
      {/* SECTION 3: Dark Logo with Aurora Glow (Light BG) */}
      {/* ============================================ */}
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-200 flex items-center justify-center relative overflow-hidden">
        {/* Aurora glow effects behind the text */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="aurora-layer aurora-cyan opacity-40" />
          <div className="aurora-layer aurora-pink opacity-40" />
        </div>
        <div className="relative z-10 inline-flex flex-col items-center">
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

      {/* ============================================ */}
      {/* SECTION 4: Color Palette */}
      {/* ============================================ */}
      <div className="min-h-screen bg-slate-950 py-20 px-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-white mb-4" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>
            COLOR PALETTE
          </h2>
          <p className="text-slate-400 mb-12 max-w-2xl">
            Les couleurs de Modal s'inspirent de l'aurore boréale : un fond nocturne profond illuminé par des lueurs cyan et magenta.
          </p>

          {/* Primary Colors */}
          <h3 className="text-xl font-semibold text-white mb-6">Couleurs Primaires</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
            <ColorSwatch color="#0B1120" name="Aurora Night" hex="#0B1120" description="Fond principal" />
            <ColorSwatch color="#1e3a5f" name="Deep Ocean" hex="#1e3a5f" description="Fond secondaire" />
            <ColorSwatch color="#0d9488" name="Aurora Cyan" hex="#0d9488" description="Accent lumineux" />
            <ColorSwatch color="#c026d3" name="Aurora Magenta" hex="#c026d3" description="Accent vif" />
          </div>

          {/* Extended Palette */}
          <h3 className="text-xl font-semibold text-white mb-6">Palette Étendue</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-12">
            <ColorSwatch color="#0f172a" name="Slate 900" hex="#0f172a" small />
            <ColorSwatch color="#1e293b" name="Slate 800" hex="#1e293b" small />
            <ColorSwatch color="#334155" name="Slate 700" hex="#334155" small />
            <ColorSwatch color="#475569" name="Slate 600" hex="#475569" small />
            <ColorSwatch color="#64748b" name="Slate 500" hex="#64748b" small />
          </div>

          {/* Aurora Gradient Stops */}
          <h3 className="text-xl font-semibold text-white mb-6">Gradient Aurora</h3>
          <div className="h-24 rounded-2xl mb-4" style={{
            background: "linear-gradient(135deg, #0B1120 0%, #1e3a5f 25%, #0d9488 50%, #c026d3 75%, #0B1120 100%)"
          }} />
          <div className="flex justify-between text-xs text-slate-500 mb-12">
            <span>0% #0B1120</span>
            <span>25% #1e3a5f</span>
            <span>50% #0d9488</span>
            <span>75% #c026d3</span>
            <span>100% #0B1120</span>
          </div>

          {/* Text Colors */}
          <h3 className="text-xl font-semibold text-white mb-6">Couleurs de Texte</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-slate-900 rounded-xl p-6">
              <p className="text-white text-lg mb-2">White</p>
              <p className="text-white/80 text-sm mb-2">White/80</p>
              <p className="text-white/60 text-sm mb-2">White/60</p>
              <p className="text-slate-400 text-sm">Slate 400</p>
            </div>
            <div className="bg-white rounded-xl p-6">
              <p className="text-slate-900 text-lg mb-2">Slate 900</p>
              <p className="text-slate-700 text-sm mb-2">Slate 700</p>
              <p className="text-slate-500 text-sm mb-2">Slate 500</p>
              <p className="text-slate-400 text-sm">Slate 400</p>
            </div>
            <div className="bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl p-6 relative overflow-hidden">
              <div className="absolute inset-0 opacity-30">
                <div className="aurora-layer aurora-cyan" style={{ opacity: 0.5 }} />
                <div className="aurora-layer aurora-pink" style={{ opacity: 0.5 }} />
              </div>
              <p className="relative text-white text-lg mb-2 drop-shadow-[0_0_20px_rgba(6,182,212,0.8)]">White + Glow</p>
              <p className="relative text-cyan-400 text-sm mb-2">Cyan 400</p>
              <p className="relative text-fuchsia-400 text-sm">Fuchsia 400</p>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================ */}
      {/* SECTION 5: Typography */}
      {/* ============================================ */}
      <div className="min-h-screen bg-white py-20 px-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-slate-900 mb-4" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>
            TYPOGRAPHY
          </h2>
          <p className="text-slate-600 mb-12 max-w-2xl">
            Saira Extra Condensed pour les titres et le logo. Inter pour le texte courant.
          </p>

          {/* Font Families */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-16">
            <div>
              <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">Display / Logo</h3>
              <p className="text-6xl font-bold text-slate-900 mb-2" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>
                Saira Extra Condensed
              </p>
              <p className="text-slate-500 text-sm">
                Font-weight: 700 (Bold) • Condensed pour un impact maximal
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-4">Body Text</h3>
              <p className="text-4xl font-medium text-slate-900 mb-2">
                Inter
              </p>
              <p className="text-slate-500 text-sm">
                Font-weight: 400-600 • Lisibilité optimale pour le texte
              </p>
            </div>
          </div>

          {/* Type Scale - Dark */}
          <h3 className="text-xl font-semibold text-slate-900 mb-6">Échelle Typographique — Sombre</h3>
          <div className="bg-white border border-slate-200 rounded-2xl p-8 mb-12 space-y-6">
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-400 w-20">10rem</span>
              <span className="text-[10rem] leading-none font-bold text-slate-900" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>MODAL</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-400 w-20">6rem</span>
              <span className="text-[6rem] leading-none font-bold text-slate-900" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>MODAL</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-400 w-20">4rem</span>
              <span className="text-[4rem] leading-none font-bold text-slate-900" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>MODAL</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-400 w-20">2rem</span>
              <span className="text-[2rem] leading-none font-bold text-slate-900" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>MODAL</span>
            </div>
          </div>

          {/* Type Scale - Gradient */}
          <h3 className="text-xl font-semibold text-slate-900 mb-6">Échelle Typographique — Gradient Foncé</h3>
          <div className="bg-white border border-slate-200 rounded-2xl p-8 mb-12 space-y-6">
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-400 w-20">10rem</span>
              <span
                className="text-[10rem] leading-none font-bold bg-gradient-to-br from-slate-900 via-slate-700 to-indigo-900 bg-clip-text text-transparent"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >MODAL</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-400 w-20">6rem</span>
              <span
                className="text-[6rem] leading-none font-bold bg-gradient-to-br from-slate-900 via-slate-700 to-indigo-900 bg-clip-text text-transparent"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >MODAL</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-400 w-20">4rem</span>
              <span
                className="text-[4rem] leading-none font-bold bg-gradient-to-br from-slate-900 via-slate-700 to-indigo-900 bg-clip-text text-transparent"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >MODAL</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-400 w-20">2rem</span>
              <span
                className="text-[2rem] leading-none font-bold bg-gradient-to-br from-slate-900 via-slate-700 to-indigo-900 bg-clip-text text-transparent"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >MODAL</span>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================ */}
      {/* SECTION 6: Dark Text + Aurora Background */}
      {/* ============================================ */}
      <div className="min-h-screen bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200 py-20 px-8 relative overflow-hidden">
        {/* Aurora effects */}
        <div className="absolute inset-0">
          <div className="aurora-layer aurora-cyan opacity-50" />
          <div className="aurora-layer aurora-pink opacity-50" />
        </div>

        <div className="max-w-6xl mx-auto relative z-10">
          <h2
            className="text-4xl font-bold bg-gradient-to-br from-slate-900 via-slate-700 to-indigo-900 bg-clip-text text-transparent mb-4"
            style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
          >
            DARK TEXT + AURORA BACKGROUND
          </h2>
          <p className="text-slate-700 mb-12 max-w-2xl">
            Texte foncé sur fond clair avec effets aurora. Meilleure lisibilité tout en gardant l'atmosphère lumineuse.
          </p>

          {/* Type Scale - Dark on Aurora */}
          <div className="space-y-8">
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-600 w-20">10rem</span>
              <span
                className="text-[10rem] leading-none font-bold bg-gradient-to-br from-slate-900 via-slate-700 to-indigo-900 bg-clip-text text-transparent"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >MODAL</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-600 w-20">6rem</span>
              <span
                className="text-[6rem] leading-none font-bold bg-gradient-to-br from-slate-900 via-slate-700 to-indigo-900 bg-clip-text text-transparent"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >MODAL</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-600 w-20">4rem</span>
              <span
                className="text-[4rem] leading-none font-bold bg-gradient-to-br from-slate-900 via-slate-700 to-indigo-900 bg-clip-text text-transparent"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >MODAL</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-600 w-20">2rem</span>
              <span
                className="text-[2rem] leading-none font-bold bg-gradient-to-br from-slate-900 via-slate-700 to-indigo-900 bg-clip-text text-transparent"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >MODAL</span>
            </div>
          </div>

          {/* Tagline variations */}
          <div className="mt-16 space-y-4">
            <p className="text-slate-900 text-2xl" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>
              CAPTURE. CONNECT. UNDERSTAND.
            </p>
            <p className="text-slate-700 text-xl" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>
              CAPTURE. CONNECT. UNDERSTAND.
            </p>
            <p className="text-slate-500 text-lg" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>
              CAPTURE. CONNECT. UNDERSTAND.
            </p>
          </div>
        </div>
      </div>

      {/* ============================================ */}
      {/* SECTION 7: Dark Background Typography */}
      {/* ============================================ */}
      <div className="min-h-screen relative overflow-hidden py-20 px-8">
        <div className="absolute inset-0 bg-[#0B1120]">
          <div className="aurora-layer aurora-cyan" />
          <div className="aurora-layer aurora-pink" />
        </div>

        <div className="max-w-6xl mx-auto relative z-10">
          <h2
            className="text-4xl font-bold text-white mb-4"
            style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
          >
            DARK BACKGROUND
          </h2>
          <p className="text-slate-400 mb-12 max-w-2xl">
            Texte blanc pur sur fond aurora. La version principale pour les interfaces sombres.
          </p>

          {/* Type Scale - White on Dark */}
          <div className="space-y-8">
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-500 w-20">10rem</span>
              <span
                className="text-[10rem] leading-none font-bold text-white"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >MODAL</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-500 w-20">6rem</span>
              <span
                className="text-[6rem] leading-none font-bold text-white"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >MODAL</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-500 w-20">4rem</span>
              <span
                className="text-[4rem] leading-none font-bold text-white"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >MODAL</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-xs text-slate-500 w-20">2rem</span>
              <span
                className="text-[2rem] leading-none font-bold text-white"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >MODAL</span>
            </div>
          </div>

          {/* Opacity variations */}
          <div className="mt-16 grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <p className="text-white text-4xl font-bold mb-2" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>MODAL</p>
              <p className="text-xs text-slate-500">white (100%)</p>
            </div>
            <div>
              <p className="text-white/80 text-4xl font-bold mb-2" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>MODAL</p>
              <p className="text-xs text-slate-500">white/80</p>
            </div>
            <div>
              <p className="text-white/60 text-4xl font-bold mb-2" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>MODAL</p>
              <p className="text-xs text-slate-500">white/60</p>
            </div>
            <div>
              <p className="text-white/40 text-4xl font-bold mb-2" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>MODAL</p>
              <p className="text-xs text-slate-500">white/40</p>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================ */}
      {/* SECTION 8: Buttons */}
      {/* ============================================ */}
      <div className="min-h-screen bg-slate-950 py-20 px-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-[#0B1120]">
          <div className="aurora-layer aurora-cyan opacity-30" />
          <div className="aurora-layer aurora-pink opacity-30" />
        </div>
        <div className="max-w-6xl mx-auto relative z-10">
          <h2
            className="text-4xl font-bold text-white mb-4"
            style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
          >
            BUTTONS
          </h2>
          <p className="text-slate-400 mb-12 max-w-2xl">
            Composant Button avec plusieurs variantes et tailles. Utilise class-variance-authority pour une gestion cohérente des styles.
          </p>

          {/* Button Variants */}
          <h3 className="text-xl font-semibold text-white mb-6">Variantes</h3>
          <div className="flex flex-wrap gap-4 mb-12">
            <div className="space-y-2">
              <Button variant="default">Default</Button>
              <p className="text-xs text-slate-500">default</p>
            </div>
            <div className="space-y-2">
              <Button variant="secondary">Secondary</Button>
              <p className="text-xs text-slate-500">secondary</p>
            </div>
            <div className="space-y-2">
              <Button variant="outline">Outline</Button>
              <p className="text-xs text-slate-500">outline</p>
            </div>
            <div className="space-y-2">
              <Button variant="ghost">Ghost</Button>
              <p className="text-xs text-slate-500">ghost</p>
            </div>
            <div className="space-y-2">
              <Button variant="glass">Glass</Button>
              <p className="text-xs text-slate-500">glass</p>
            </div>
            <div className="space-y-2">
              <Button variant="glassDark">Glass Dark</Button>
              <p className="text-xs text-slate-500">glassDark</p>
            </div>
            <div className="space-y-2">
              <Button variant="destructive">Destructive</Button>
              <p className="text-xs text-slate-500">destructive</p>
            </div>
            <div className="space-y-2">
              <Button variant="link">Link</Button>
              <p className="text-xs text-slate-500">link</p>
            </div>
          </div>

          {/* Button Sizes */}
          <h3 className="text-xl font-semibold text-white mb-6">Tailles</h3>
          <div className="flex flex-wrap items-end gap-4 mb-12">
            <div className="space-y-2">
              <Button size="sm">Small</Button>
              <p className="text-xs text-slate-500">sm</p>
            </div>
            <div className="space-y-2">
              <Button size="default">Default</Button>
              <p className="text-xs text-slate-500">default</p>
            </div>
            <div className="space-y-2">
              <Button size="lg">Large</Button>
              <p className="text-xs text-slate-500">lg</p>
            </div>
            <div className="space-y-2">
              <Button size="icon"><Plus className="h-4 w-4" /></Button>
              <p className="text-xs text-slate-500">icon</p>
            </div>
          </div>

          {/* Buttons with Icons */}
          <h3 className="text-xl font-semibold text-white mb-6">Avec Icônes</h3>
          <div className="flex flex-wrap gap-4 mb-12">
            <Button><Mail className="mr-2 h-4 w-4" />Email</Button>
            <Button variant="secondary"><Sparkles className="mr-2 h-4 w-4" />Generate</Button>
            <Button variant="outline"><Download className="mr-2 h-4 w-4" />Download</Button>
            <Button variant="destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</Button>
            <Button variant="glass"><Settings className="mr-2 h-4 w-4" />Settings</Button>
          </div>

          {/* Button States */}
          <h3 className="text-xl font-semibold text-white mb-6">États</h3>
          <div className="flex flex-wrap gap-4 mb-12">
            <div className="space-y-2">
              <Button>Normal</Button>
              <p className="text-xs text-slate-500">normal</p>
            </div>
            <div className="space-y-2">
              <Button disabled>Disabled</Button>
              <p className="text-xs text-slate-500">disabled</p>
            </div>
            <div className="space-y-2">
              <Button disabled><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading</Button>
              <p className="text-xs text-slate-500">loading</p>
            </div>
          </div>

          {/* Icon Buttons Grid */}
          <h3 className="text-xl font-semibold text-white mb-6">Boutons Icône</h3>
          <div className="flex flex-wrap gap-3">
            <Button size="icon" variant="outline"><Plus className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline"><Edit className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline"><Trash2 className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline"><Copy className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline"><Share2 className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline"><Download className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline"><Upload className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline"><Search className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline"><Settings className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline"><Filter className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline"><MoreHorizontal className="h-4 w-4" /></Button>
            <Button size="icon" variant="outline"><X className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      {/* ============================================ */}
      {/* SECTION 9: Icons */}
      {/* ============================================ */}
      <div className="min-h-screen bg-white py-20 px-8">
        <div className="max-w-6xl mx-auto">
          <h2
            className="text-4xl font-bold text-slate-900 mb-4"
            style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
          >
            ICONOGRAPHY
          </h2>
          <p className="text-slate-600 mb-12 max-w-2xl">
            Icônes provenant de Lucide React. Taille par défaut : 24x24px. Utiliser h-4 w-4 (16px) pour les boutons et éléments compacts.
          </p>

          {/* Actions */}
          <h3 className="text-xl font-semibold text-slate-900 mb-6">Actions</h3>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-6 mb-12">
            <IconDisplay icon={<Plus />} name="Plus" />
            <IconDisplay icon={<Edit />} name="Edit" />
            <IconDisplay icon={<Save />} name="Save" />
            <IconDisplay icon={<Trash2 />} name="Trash2" />
            <IconDisplay icon={<Copy />} name="Copy" />
            <IconDisplay icon={<Download />} name="Download" />
            <IconDisplay icon={<Upload />} name="Upload" />
            <IconDisplay icon={<Share2 />} name="Share2" />
            <IconDisplay icon={<Send />} name="Send" />
            <IconDisplay icon={<Search />} name="Search" />
            <IconDisplay icon={<Filter />} name="Filter" />
            <IconDisplay icon={<Settings />} name="Settings" />
            <IconDisplay icon={<Link2 />} name="Link2" />
            <IconDisplay icon={<ExternalLink />} name="ExternalLink" />
            <IconDisplay icon={<Play />} name="Play" />
            <IconDisplay icon={<Pause />} name="Pause" />
          </div>

          {/* Navigation */}
          <h3 className="text-xl font-semibold text-slate-900 mb-6">Navigation</h3>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-6 mb-12">
            <IconDisplay icon={<ArrowLeft />} name="ArrowLeft" />
            <IconDisplay icon={<ArrowRight />} name="ArrowRight" />
            <IconDisplay icon={<ChevronLeft />} name="ChevronLeft" />
            <IconDisplay icon={<ChevronRight />} name="ChevronRight" />
            <IconDisplay icon={<ChevronUp />} name="ChevronUp" />
            <IconDisplay icon={<ChevronDown />} name="ChevronDown" />
            <IconDisplay icon={<X />} name="X" />
            <IconDisplay icon={<MoreHorizontal />} name="MoreHorizontal" />
          </div>

          {/* Status */}
          <h3 className="text-xl font-semibold text-slate-900 mb-6">Status & Feedback</h3>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-6 mb-12">
            <IconDisplay icon={<CheckCircle2 />} name="CheckCircle2" />
            <IconDisplay icon={<XCircle />} name="XCircle" />
            <IconDisplay icon={<AlertCircle />} name="AlertCircle" />
            <IconDisplay icon={<AlertTriangle />} name="AlertTriangle" />
            <IconDisplay icon={<Info />} name="Info" />
            <IconDisplay icon={<HelpCircle />} name="HelpCircle" />
            <IconDisplay icon={<Loader2 className="animate-spin" />} name="Loader2" />
            <IconDisplay icon={<Bell />} name="Bell" />
          </div>

          {/* User & Security */}
          <h3 className="text-xl font-semibold text-slate-900 mb-6">User & Security</h3>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-6 mb-12">
            <IconDisplay icon={<User />} name="User" />
            <IconDisplay icon={<Mail />} name="Mail" />
            <IconDisplay icon={<Shield />} name="Shield" />
            <IconDisplay icon={<Lock />} name="Lock" />
            <IconDisplay icon={<Unlock />} name="Unlock" />
            <IconDisplay icon={<Eye />} name="Eye" />
            <IconDisplay icon={<EyeOff />} name="EyeOff" />
            <IconDisplay icon={<Heart />} name="Heart" />
          </div>

          {/* Feature Icons */}
          <h3 className="text-xl font-semibold text-slate-900 mb-6">Features</h3>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-6">
            <IconDisplay icon={<Sparkles />} name="Sparkles" />
            <IconDisplay icon={<Target />} name="Target" />
            <IconDisplay icon={<TrendingUp />} name="TrendingUp" />
            <IconDisplay icon={<Star />} name="Star" />
          </div>
        </div>
      </div>

      {/* ============================================ */}
      {/* SECTION 10: Cards & Containers */}
      {/* ============================================ */}
      <div className="min-h-screen bg-slate-950 py-20 px-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-[#0B1120]">
          <div className="aurora-layer aurora-cyan opacity-30" />
          <div className="aurora-layer aurora-pink opacity-30" />
        </div>
        <div className="max-w-6xl mx-auto relative z-10">
          <h2
            className="text-4xl font-bold text-white mb-4"
            style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
          >
            CARDS & CONTAINERS
          </h2>
          <p className="text-slate-400 mb-12 max-w-2xl">
            Différents styles de cartes pour organiser le contenu. Les neon-cards sont utilisées dans l'interface admin.
          </p>

          {/* Neon Cards */}
          <h3 className="text-xl font-semibold text-white mb-6">Neon Cards (Admin)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            <div className="neon-card p-6">
              <h4 className="text-white font-semibold mb-2">Neon Cyan</h4>
              <p className="text-slate-400 text-sm">La carte par défaut avec bordure cyan.</p>
            </div>
            <div className="neon-card-purple p-6">
              <h4 className="text-white font-semibold mb-2">Neon Purple</h4>
              <p className="text-slate-400 text-sm">Variante violette pour accent.</p>
            </div>
            <div className="neon-card-pink p-6">
              <h4 className="text-white font-semibold mb-2">Neon Pink</h4>
              <p className="text-slate-400 text-sm">Variante rose/magenta.</p>
            </div>
            <div className="neon-card-red p-6">
              <h4 className="text-white font-semibold mb-2">Neon Red</h4>
              <p className="text-slate-400 text-sm">Pour les alertes et états destructifs.</p>
            </div>
          </div>

          {/* Standard Card Component */}
          <h3 className="text-xl font-semibold text-white mb-6">Card Component</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            <Card className="border-white/10 bg-slate-900/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-white">Card Title</CardTitle>
                <CardDescription className="text-slate-400">
                  Card description with additional context.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-slate-300">Card content goes here. This is a standard card with header, content and footer sections.</p>
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button variant="outline" size="sm">Cancel</Button>
                <Button size="sm">Save</Button>
              </CardFooter>
            </Card>

            <Card className="border-white/10 bg-slate-900/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-cyan-400" />
                  Feature Card
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-slate-300">Carte avec icône dans le header pour mettre en avant une fonctionnalité.</p>
              </CardContent>
            </Card>
          </div>

          {/* Dashboard & Stat Cards */}
          <h3 className="text-xl font-semibold text-white mb-6">Dashboard Cards</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="dashboard-card p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-slate-400 text-sm">Total Users</span>
                <User className="h-5 w-5 text-cyan-400" />
              </div>
              <p className="text-3xl font-bold text-white">1,234</p>
              <p className="text-green-400 text-sm mt-2">+12% from last month</p>
            </div>
            <div className="stat-card p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-slate-400 text-sm">Active Sessions</span>
                <Target className="h-5 w-5 text-fuchsia-400" />
              </div>
              <p className="text-3xl font-bold text-white">89</p>
              <p className="text-cyan-400 text-sm mt-2">Live now</p>
            </div>
            <div className="stat-card p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-slate-400 text-sm">Completion Rate</span>
                <TrendingUp className="h-5 w-5 text-green-400" />
              </div>
              <p className="text-3xl font-bold text-white">94%</p>
              <p className="text-slate-400 text-sm mt-2">Average</p>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================ */}
      {/* SECTION 11: Form Elements */}
      {/* ============================================ */}
      <div className="min-h-screen bg-white py-20 px-8">
        <div className="max-w-6xl mx-auto">
          <h2
            className="text-4xl font-bold text-slate-900 mb-4"
            style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
          >
            FORM ELEMENTS
          </h2>
          <p className="text-slate-600 mb-12 max-w-2xl">
            Éléments de formulaire avec styles cohérents pour les thèmes clair et sombre.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            {/* Light Theme Forms */}
            <div>
              <h3 className="text-xl font-semibold text-slate-900 mb-6">Light Theme</h3>
              <div className="space-y-6 p-6 rounded-2xl border border-slate-200 bg-white">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Input</label>
                  <Input placeholder="Enter your email..." />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Input with icon</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input placeholder="vous@exemple.com" className="pl-10" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Search Input</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input placeholder="Search..." className="pl-10" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Textarea</label>
                  <Textarea placeholder="Write your message here..." rows={3} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Disabled Input</label>
                  <Input disabled placeholder="Disabled input" />
                </div>
              </div>
            </div>

            {/* Dark Theme Forms */}
            <div>
              <h3 className="text-xl font-semibold text-slate-900 mb-6">Dark Theme</h3>
              <div className="space-y-6 p-6 rounded-2xl bg-slate-900">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Input</label>
                  <Input
                    placeholder="Enter your email..."
                    className="border-white/10 bg-slate-800/50 text-white placeholder:text-slate-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Input with icon</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      placeholder="vous@exemple.com"
                      className="border-white/10 bg-slate-800/50 pl-10 text-white placeholder:text-slate-500"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Search Input</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      placeholder="Search..."
                      className="border-white/10 bg-slate-800/50 pl-10 text-white placeholder:text-slate-500"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Textarea</label>
                  <Textarea
                    placeholder="Write your message here..."
                    rows={3}
                    className="border-white/10 bg-slate-800/50 text-white placeholder:text-slate-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">Disabled Input</label>
                  <Input
                    disabled
                    placeholder="Disabled input"
                    className="border-white/10 bg-slate-800/50 text-white placeholder:text-slate-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================ */}
      {/* SECTION 12: Badges & Alerts */}
      {/* ============================================ */}
      <div className="min-h-screen bg-slate-950 py-20 px-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-[#0B1120]">
          <div className="aurora-layer aurora-cyan opacity-30" />
          <div className="aurora-layer aurora-pink opacity-30" />
        </div>
        <div className="max-w-6xl mx-auto relative z-10">
          <h2
            className="text-4xl font-bold text-white mb-4"
            style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
          >
            BADGES & ALERTS
          </h2>
          <p className="text-slate-400 mb-12 max-w-2xl">
            Badges pour les labels et statuts. Alertes pour les messages importants.
          </p>

          {/* Badges */}
          <h3 className="text-xl font-semibold text-white mb-6">Badges</h3>
          <div className="flex flex-wrap gap-4 mb-12">
            <div className="space-y-2">
              <Badge>Default</Badge>
              <p className="text-xs text-slate-500">default</p>
            </div>
            <div className="space-y-2">
              <Badge variant="secondary">Secondary</Badge>
              <p className="text-xs text-slate-500">secondary</p>
            </div>
            <div className="space-y-2">
              <Badge variant="destructive">Destructive</Badge>
              <p className="text-xs text-slate-500">destructive</p>
            </div>
            <div className="space-y-2">
              <Badge variant="outline">Outline</Badge>
              <p className="text-xs text-slate-500">outline</p>
            </div>
          </div>

          {/* Custom Badges */}
          <h3 className="text-xl font-semibold text-white mb-6">Badges Personnalisés</h3>
          <div className="flex flex-wrap gap-4 mb-12">
            <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">Active</Badge>
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Completed</Badge>
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">Pending</Badge>
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Error</Badge>
            <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">New</Badge>
            <Badge className="bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30">AI</Badge>
          </div>

          {/* Alerts */}
          <h3 className="text-xl font-semibold text-white mb-6">Alerts (Light Theme)</h3>
          <div className="space-y-4 bg-white rounded-2xl p-6">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Information</AlertTitle>
              <AlertDescription>
                This is an informational alert with default styling.
              </AlertDescription>
            </Alert>

            <Alert className="border-green-500/50 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-800">Success</AlertTitle>
              <AlertDescription className="text-green-700">
                Your changes have been saved successfully.
              </AlertDescription>
            </Alert>

            <Alert className="border-amber-500/50 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-800">Warning</AlertTitle>
              <AlertDescription className="text-amber-700">
                Please review your settings before continuing.
              </AlertDescription>
            </Alert>

            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                Something went wrong. Please try again later.
              </AlertDescription>
            </Alert>
          </div>

          {/* Dark Theme Alerts */}
          <h3 className="text-xl font-semibold text-white mt-12 mb-6">Alerts (Dark Theme)</h3>
          <div className="space-y-4">
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-4 flex gap-3">
              <Info className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-cyan-400">Information</p>
                <p className="text-sm text-slate-300 mt-1">This is an informational message for dark theme.</p>
              </div>
            </div>

            <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4 flex gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-green-400">Success</p>
                <p className="text-sm text-slate-300 mt-1">Operation completed successfully.</p>
              </div>
            </div>

            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 flex gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-400">Warning</p>
                <p className="text-sm text-slate-300 mt-1">Please review before continuing.</p>
              </div>
            </div>

            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 flex gap-3">
              <XCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-400">Error</p>
                <p className="text-sm text-slate-300 mt-1">Something went wrong. Please try again.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================ */}
      {/* SECTION 13: Text Effects */}
      {/* ============================================ */}
      <div className="min-h-screen bg-slate-950 py-20 px-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-[#0B1120]">
          <div className="aurora-layer aurora-cyan" />
          <div className="aurora-layer aurora-pink" />
        </div>
        <div className="max-w-6xl mx-auto relative z-10">
          <h2
            className="text-4xl font-bold text-white mb-4"
            style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
          >
            TEXT EFFECTS
          </h2>
          <p className="text-slate-400 mb-12 max-w-2xl">
            Effets de texte spéciaux : glow, gradient et animation.
          </p>

          {/* Glow Effects */}
          <h3 className="text-xl font-semibold text-white mb-6">Glow Effects</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            <div className="text-center">
              <p className="text-4xl font-bold text-white text-glow-cyan" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>MODAL</p>
              <p className="text-xs text-slate-500 mt-2">text-glow-cyan</p>
            </div>
            <div className="text-center">
              <p className="text-4xl font-bold text-white text-glow-purple" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>MODAL</p>
              <p className="text-xs text-slate-500 mt-2">text-glow-purple</p>
            </div>
            <div className="text-center">
              <p className="text-4xl font-bold text-white text-glow-pink" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>MODAL</p>
              <p className="text-xs text-slate-500 mt-2">text-glow-pink</p>
            </div>
          </div>

          {/* Gradient Texts */}
          <h3 className="text-xl font-semibold text-white mb-6">Gradient Texts</h3>
          <div className="space-y-6 mb-12">
            <div>
              <p
                className="text-4xl font-bold bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >
                GRADIENT CYAN TO PINK
              </p>
              <p className="text-xs text-slate-500 mt-2">from-cyan-400 via-fuchsia-500 to-pink-500</p>
            </div>
            <div>
              <p
                className="text-4xl font-bold bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >
                GRADIENT INDIGO TO PINK
              </p>
              <p className="text-xs text-slate-500 mt-2">from-indigo-500 via-purple-500 to-pink-500</p>
            </div>
            <div>
              <p
                className="text-4xl font-bold bg-gradient-to-br from-teal-400 to-cyan-500 bg-clip-text text-transparent"
                style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}
              >
                GRADIENT TEAL TO CYAN
              </p>
              <p className="text-xs text-slate-500 mt-2">from-teal-400 to-cyan-500</p>
            </div>
          </div>

          {/* Animated Gradient */}
          <h3 className="text-xl font-semibold text-white mb-6">Animated Gradient</h3>
          <div className="text-center">
            <p
              className="text-6xl font-bold bg-clip-text text-transparent animate-aurora-text"
              style={{
                fontFamily: "'Saira Extra Condensed', sans-serif",
                backgroundImage: "linear-gradient(135deg, #0d9488 0%, #c026d3 25%, #f472b6 50%, #0891b2 75%, #0d9488 100%)",
                backgroundSize: "300% 300%",
              }}
            >
              AURORA ANIMATED TEXT
            </p>
            <p className="text-xs text-slate-500 mt-4">animate-aurora-text (20s cycle)</p>
          </div>
        </div>
      </div>

      {/* Animation keyframes */}
      <style jsx>{`
        @keyframes aurora-text {
          0%, 100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }
        .animate-aurora-text {
          animation: aurora-text 20s ease-in-out infinite;
        }
        @keyframes glow {
          0%, 100% {
            filter: drop-shadow(0 0 60px rgba(6, 182, 212, 0.6));
          }
          50% {
            filter: drop-shadow(0 0 80px rgba(192, 38, 211, 0.6));
          }
        }
        .animate-glow {
          animation: glow 8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

// Icon Display Component
function IconDisplay({ icon, name }: { icon: React.ReactNode; name: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="h-12 w-12 flex items-center justify-center rounded-lg bg-slate-100 text-slate-700">
        {icon}
      </div>
      <span className="text-xs text-slate-500">{name}</span>
    </div>
  );
}

// Color Swatch Component
function ColorSwatch({
  color,
  name,
  hex,
  description,
  small = false
}: {
  color: string;
  name: string;
  hex: string;
  description?: string;
  small?: boolean;
}) {
  return (
    <div className={small ? "" : ""}>
      <div
        className={`${small ? "h-16" : "h-24"} rounded-xl mb-3 border border-white/10`}
        style={{ backgroundColor: color }}
      />
      <p className={`font-medium text-white ${small ? "text-sm" : ""}`}>{name}</p>
      <p className={`text-slate-500 font-mono ${small ? "text-xs" : "text-sm"}`}>{hex}</p>
      {description && <p className="text-slate-600 text-xs mt-1">{description}</p>}
    </div>
  );
}
