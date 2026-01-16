"use client";

import { useMemo, useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bot,
  Building2,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  LayoutDashboard,
  Menu,
  MessageSquare,
  ScrollText,
  Search,
  Target,
  Users,
  X,
  Loader2,
  type LucideIcon
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UserProfileMenu } from "@/components/auth/UserProfileMenu";
import { AdminSearchProvider, useAdminSearch, type SearchResultItem } from "./AdminSearchContext";
import { AdminAuthGuard } from "./AdminAuthGuard";
import { ClientProvider, useClientContext } from "./ClientContext";
import { ClientSelector } from "./ClientSelector";
import { ProjectProvider, useProjectContext } from "./ProjectContext";
import { ProjectSelector } from "./ProjectSelector";
import { Input } from "@/components/ui/input";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAdminSearchData } from "./useAdminSearchData";

interface AdminPageLayoutProps {
  children: ReactNode;
}

interface AdminNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** If set, only users with one of these roles can see this item */
  requiredRoles?: string[];
}

const navigationItems: AdminNavItem[] = [
  {
    label: "Dashboard",
    href: "/admin",
    icon: LayoutDashboard,
  },
  {
    label: "Clients",
    href: "/admin/clients",
    icon: Building2,
  },
  {
    label: "Projects",
    href: "/admin/projects",
    icon: FolderKanban,
  },
  {
    label: "Users",
    href: "/admin/users",
    icon: Users,
  },
  {
    label: "AI agents",
    href: "/admin/ai",
    icon: Bot,
    requiredRoles: ["full_admin"],
  },
  {
    label: "AI logs",
    href: "/admin/ai/logs",
    icon: ScrollText,
    requiredRoles: ["full_admin"],
  },
];

function AdminSearchBar() {
  const search = useAdminSearch();

  if (!search || !search.searchResultTypeConfig || Object.keys(search.searchResultTypeConfig).length === 0) {
    // Show a disabled search bar if context is not fully initialized
    return (
      <div className="hidden md:flex md:max-w-md">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Search across clients, projects, sessions..."
            className="w-full rounded-xl border-white/10 bg-white/5 pl-9 pr-10 text-sm text-white placeholder:text-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0 opacity-50"
            aria-label="Search across clients, projects, sessions"
            disabled
          />
        </div>
      </div>
    );
  }

  const {
    searchQuery,
    isSearchFocused,
    useVectorSearch,
    setUseVectorSearch,
    isVectorSearching,
    enhancedSearchResults,
    hasSearchResults,
    showSearchDropdown,
    searchInputRef,
    searchResultTypeConfig,
    handleSearchChange,
    handleSearchFocus,
    handleSearchBlur,
    handleSearchKeyDown,
    handleClearSearch,
    handleSearchSelect,
  } = search;

  return (
    <div className="hidden md:flex md:max-w-md">
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <Input
          ref={searchInputRef}
          value={searchQuery}
          onChange={handleSearchChange}
          onFocus={handleSearchFocus}
          onBlur={handleSearchBlur}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search across clients, projects, sessions..."
          className="w-full rounded-xl border-white/10 bg-white/5 pl-9 pr-10 text-sm text-white placeholder:text-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
          aria-label="Search across clients, projects, sessions"
          aria-expanded={showSearchDropdown && hasSearchResults}
          aria-haspopup="listbox"
          aria-controls="admin-search-results"
          role="combobox"
          autoComplete="off"
        />
        {searchQuery && (
          <button
            type="button"
            onMouseDown={event => event.preventDefault()}
            onClick={handleClearSearch}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-300 transition hover:text-white"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <AnimatePresence>
          {showSearchDropdown && (
            <motion.div
              id="admin-search-results"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 right-0 top-12 z-50 rounded-2xl border border-white/10 bg-slate-950/90 p-3 shadow-2xl backdrop-blur"
              role="listbox"
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs uppercase tracking-wide text-slate-400">Results</span>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={useVectorSearch}
                      onChange={(e) => setUseVectorSearch(e.target.checked)}
                      className="h-3 w-3 rounded border-white/20 bg-slate-900"
                    />
                    <span>Recherche sémantique</span>
                    {isVectorSearching && <Loader2 className="h-3 w-3 animate-spin" />}
                  </label>
                </div>
                <span className="text-xs uppercase tracking-wide text-slate-400">
                  {hasSearchResults
                    ? `${enhancedSearchResults.length} match${enhancedSearchResults.length > 1 ? "es" : ""}`
                    : "No results"}
                </span>
              </div>
              <div className="space-y-1">
                {hasSearchResults ? (
                  enhancedSearchResults.map(result => {
                    const config = searchResultTypeConfig[result.type];
                    const Icon = config.icon;
                    return (
                      <button
                        key={`${result.type}-${result.id}`}
                        type="button"
                        className="flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => handleSearchSelect(result)}
                        role="option"
                      >
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-white">{result.title}</p>
                          <p className="text-xs text-slate-300">
                            {config.label}
                            {result.subtitle ? ` • ${result.subtitle}` : ""}
                          </p>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-4 text-sm text-slate-300">
                    No matches for &ldquo;{searchQuery}&rdquo;
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function AdminLayoutInner({ children }: AdminPageLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useAuth();
  const { setSelectedClientId } = useClientContext();
  const { setSelectedProjectId } = useProjectContext();
  const { search } = useAdminSearchData();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Filter navigation items based on user role
  const userRole = profile?.role?.toLowerCase() ?? "";
  const visibleNavItems = useMemo(() => {
    return navigationItems.filter(item => {
      if (!item.requiredRoles) return true;
      return item.requiredRoles.map(r => r.toLowerCase()).includes(userRole);
    });
  }, [userRole]);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [useVectorSearch, setUseVectorSearch] = useState(false);
  const [isVectorSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchBlurTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const searchResultTypeConfig = useMemo(() => ({
    client: { label: "Client", icon: Building2 },
    project: { label: "Project", icon: FolderKanban },
    challenge: { label: "Challenge", icon: Target },
    ask: { label: "ASK Session", icon: MessageSquare },
    user: { label: "User", icon: Users },
  }), []);

  // Compute search results when query changes
  const enhancedSearchResults = useMemo(() => {
    return search(searchQuery);
  }, [search, searchQuery]);

  const hasSearchResults = enhancedSearchResults.length > 0;
  const showSearchDropdown = isSearchFocused && (searchQuery.trim().length > 0 || (useVectorSearch && enhancedSearchResults.length > 0));

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  }, []);

  const handleSearchFocus = useCallback(() => {
    if (searchBlurTimeoutRef.current) {
      clearTimeout(searchBlurTimeoutRef.current);
      searchBlurTimeoutRef.current = null;
    }
    setIsSearchFocused(true);
  }, []);

  const handleSearchBlur = useCallback(() => {
    searchBlurTimeoutRef.current = setTimeout(() => {
      setIsSearchFocused(false);
    }, 150);
  }, []);

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSearchQuery("");
        setIsSearchFocused(false);
        searchInputRef.current?.blur();
      }
    },
    []
  );

  const handleClearSearch = useCallback(() => {
    if (searchBlurTimeoutRef.current) {
      clearTimeout(searchBlurTimeoutRef.current);
      searchBlurTimeoutRef.current = null;
    }
    setSearchQuery("");
    setIsSearchFocused(true);
    searchInputRef.current?.focus();
  }, []);

  const handleSearchSelect = useCallback((result: SearchResultItem) => {
    if (searchBlurTimeoutRef.current) {
      clearTimeout(searchBlurTimeoutRef.current);
      searchBlurTimeoutRef.current = null;
    }

    // Set client context if applicable
    if (result.clientId) {
      setSelectedClientId(result.clientId);
    } else if (result.type === "client") {
      setSelectedClientId(result.id);
    }

    // Set project context if applicable
    if (result.projectId) {
      setSelectedProjectId(result.projectId);
    } else if (result.type === "project") {
      setSelectedProjectId(result.id);
    }

    // Navigate to appropriate page
    switch (result.type) {
      case "client":
        router.push("/admin/projects");
        break;
      case "project":
        router.push(`/admin/projects/${result.id}`);
        break;
      case "challenge":
      case "ask":
        if (result.projectId) {
          router.push(`/admin/projects/${result.projectId}`);
        } else {
          router.push("/admin");
        }
        break;
      case "user":
        router.push("/admin/users");
        break;
    }

    setSearchQuery("");
    setIsSearchFocused(false);
    searchInputRef.current?.blur();
  }, [router, setSelectedClientId, setSelectedProjectId]);

  const searchContext = useMemo(() => ({
    searchQuery,
    setSearchQuery,
    isSearchFocused,
    setIsSearchFocused,
    useVectorSearch,
    setUseVectorSearch,
    isVectorSearching,
    enhancedSearchResults,
    hasSearchResults,
    showSearchDropdown,
    searchInputRef,
    searchResultTypeConfig,
    handleSearchChange,
    handleSearchFocus,
    handleSearchBlur,
    handleSearchKeyDown,
    handleClearSearch,
    handleSearchSelect,
  }), [
    searchQuery,
    isSearchFocused,
    useVectorSearch,
    isVectorSearching,
    enhancedSearchResults,
    hasSearchResults,
    showSearchDropdown,
    searchResultTypeConfig,
    handleSearchChange,
    handleSearchFocus,
    handleSearchBlur,
    handleSearchKeyDown,
    handleClearSearch,
    handleSearchSelect,
  ]);

  const activeHref = useMemo(() => {
    // Filter all matching items, then pick the most specific (longest href)
    const matchingItems = visibleNavItems.filter(item => {
      if (item.href === "/admin") {
        return pathname === item.href;
      }
      return pathname.startsWith(item.href);
    });
    // Sort by href length descending to get the most specific match
    const mostSpecific = matchingItems.sort(
      (a, b) => b.href.length - a.href.length
    )[0];
    return mostSpecific?.href ?? null;
  }, [pathname, visibleNavItems]);

  const sidebarContent = (
    <div className="flex h-full flex-col gap-6 overflow-hidden">
      <div className={cn(
        "flex items-center gap-3 overflow-hidden",
        isSidebarCollapsed ? "flex-col" : "justify-between"
      )}>
        <div
          className={cn(
            "flex items-center gap-2 text-left flex-shrink-0",
            isSidebarCollapsed ? "justify-center" : ""
          )}
        >
          {/* Logo with primary/accent gradient */}
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-sm font-bold text-white shadow-lg">
            M
          </div>
          {!isSidebarCollapsed && (
            <div className="overflow-hidden">
              <div className="text-lg font-bold text-white truncate" style={{ fontFamily: "'Saira Extra Condensed', sans-serif" }}>MODAL</div>
              <p className="text-[10px] text-neon-cyan/60 truncate tracking-wider">Capture. Connect. Understand.</p>
            </div>
          )}
        </div>
        <button
          type="button"
          className="hidden rounded-xl border border-neon-cyan/20 bg-dark-700/50 p-2 text-slate-200 transition hover:bg-dark-600/50 hover:border-neon-cyan/40 hover:shadow-glow-cyan md:inline-flex flex-shrink-0"
          onClick={() => setIsSidebarCollapsed(value => !value)}
          aria-label={isSidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {isSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <ClientSelector collapsed={isSidebarCollapsed} />
      <ProjectSelector collapsed={isSidebarCollapsed} />

      <nav className="flex flex-1 flex-col gap-1 overflow-hidden">
        {visibleNavItems.map(item => {
          const Icon = item.icon;
          const isActive = activeHref === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-200 overflow-hidden",
                isActive
                  ? "bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 shadow-glow-cyan"
                  : "text-slate-300 hover:bg-dark-600/50 hover:text-white border border-transparent",
                isSidebarCollapsed ? "justify-center px-2" : ""
              )}
              onClick={() => setIsMobileSidebarOpen(false)}
            >
              <Icon className={cn("h-4 w-4 flex-shrink-0", isActive && "text-neon-cyan")} />
              {!isSidebarCollapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {!isSidebarCollapsed && (
        <div className="neon-card-purple rounded-2xl p-4 text-sm text-slate-300">
          <p className="font-medium text-neon-purple">Need help?</p>
          <p className="mt-1 text-slate-400">Review the admin playbook or contact the product team.</p>
        </div>
      )}
    </div>
  );

  return (
    <AdminSearchProvider value={searchContext}>
      {/* Aurora animated background */}
      <div className="aurora-background" aria-hidden="true">
        <div className="aurora-layer aurora-cyan" />
        <div className="aurora-layer aurora-pink" />
      </div>

      <div className="admin-layout min-h-screen h-screen overflow-hidden text-slate-100 relative z-0">
        <div className="flex h-full min-h-0">
          {/* Sidebar with neon glow border */}
          <aside
            className={cn(
              "hidden border-r border-neon-cyan/20 bg-dark-800/70 px-5 py-6 backdrop-blur-xl md:flex",
              "shadow-[inset_-1px_0_0_hsla(185,100%,50%,0.1)]",
              isSidebarCollapsed ? "w-20" : "w-64"
            )}
          >
            {sidebarContent}
          </aside>

          {/* Mobile sidebar overlay */}
          {isMobileSidebarOpen ? (
            <div className="fixed inset-0 z-50 flex md:hidden">
              <button
                type="button"
                className="absolute inset-0 bg-dark-900/80 backdrop-blur-sm"
                onClick={() => setIsMobileSidebarOpen(false)}
                aria-label="Close navigation"
              />
              <div className="relative z-10 h-full w-72 border-r border-neon-cyan/20 bg-dark-800/95 px-5 py-6 shadow-glow-cyan">
                {sidebarContent}
              </div>
            </div>
          ) : null}

          <div className="flex flex-1 flex-col min-h-0">
            {/* Header with subtle glow */}
            <header className="sticky top-0 z-40 border-b border-neon-cyan/10 bg-dark-900/80 backdrop-blur-xl">
              <div className="flex items-center justify-between px-4 py-4 md:px-6">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-neon-cyan/20 bg-dark-700/50 text-foreground transition hover:bg-dark-600/50 hover:border-neon-cyan/40 hover:shadow-glow-cyan md:hidden"
                    onClick={() => setIsMobileSidebarOpen(true)}
                    aria-label="Open navigation"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                  <div className="hidden text-sm text-slate-400 md:block">Admin console</div>
                  <AdminSearchBar />
                </div>
                <div className="flex items-center gap-3">
                  <UserProfileMenu />
                </div>
              </div>
            </header>

            {/* Main content area */}
            <main className="flex-1 overflow-y-auto px-4 py-6 md:px-6 lg:px-10">
              <AdminAuthGuard>
                {children}
              </AdminAuthGuard>
            </main>
          </div>
        </div>
      </div>
    </AdminSearchProvider>
  );
}

export function AdminPageLayout({ children }: AdminPageLayoutProps) {
  return (
    <ClientProvider>
      <ProjectProvider>
        <AdminLayoutInner>{children}</AdminLayoutInner>
      </ProjectProvider>
    </ClientProvider>
  );
}
