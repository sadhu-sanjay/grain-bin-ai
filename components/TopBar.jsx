"use client";

import { useEffect, useRef, useState } from "react";

// Result types Nominatim can tag a place with. We only want places that make
// sense as the center of a 25-mile grain-storage search — towns, cities,
// counties — not shops, restaurants, or individual buildings.
const RELEVANT_CLASSES = new Set(["place", "boundary"]);
const RELEVANT_TYPES = new Set([
  "city",
  "town",
  "village",
  "hamlet",
  "county",
  "municipality",
  "administrative",
  "township",
]);

function isRelevantPlace(result) {
  return (
    RELEVANT_CLASSES.has(result.class) && RELEVANT_TYPES.has(result.type)
  );
}

// Turns Nominatim's full display_name into a short "Town, State" label
// instead of the full comma-separated address string.
function shortLabel(result) {
  const addr = result.address || {};
  const place =
    addr.city || addr.town || addr.village || addr.hamlet || addr.county;
  const state = addr.state;
  if (place && state) return `${place}, ${state}`;
  return result.display_name.split(",").slice(0, 2).join(",").trim();
}

const DEBOUNCE_MS = 300;

export default function TopBar({ onSearch, hoveredCounty, searching }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [error, setError] = useState(null);

  const debounceRef = useRef(null);
  const containerRef = useRef(null);
  const skipNextFetch = useRef(false);

  useEffect(() => {
    // Close the dropdown on outside clicks.
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (skipNextFetch.current) {
      // Query was just set programmatically (e.g. after picking a
      // suggestion) — don't immediately re-search it.
      skipNextFetch.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&countrycodes=us&q=${encodeURIComponent(
            trimmed
          )}`
        );
        const results = await res.json();
        const filtered = results.filter(isRelevantPlace).slice(0, 5);
        setSuggestions(filtered);
        setOpen(filtered.length > 0);
        setActiveIndex(-1);
      } catch {
        // Silently drop suggestion errors — the user can still press
        // Enter to fall back to a direct search.
      } finally {
        setLoadingSuggestions(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  function pickSuggestion(result) {
    skipNextFetch.current = true;
    setQuery(shortLabel(result));
    setSuggestions([]);
    setOpen(false);
    setError(null);
    onSearch(parseFloat(result.lat), parseFloat(result.lon), shortLabel(result));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!query.trim()) return;

    // If a suggestion is highlighted, use it.
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      pickSuggestion(suggestions[activeIndex]);
      return;
    }
    // Otherwise fall back to a direct one-shot geocode of whatever was typed.
    setError(null);
    setOpen(false);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(
          query
        )}`
      );
      const results = await res.json();
      if (!results?.length) {
        setError("Couldn't find that place — try a different town or county.");
        return;
      }
      const { lat, lon, display_name } = results[0];
      onSearch(parseFloat(lat), parseFloat(lon), display_name.split(",")[0]);
    } catch {
      setError("Search failed — check your connection and try again.");
    }
  }

  function handleKeyDown(e) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-mark" />
        <h1>Grain Bin AI</h1>
        <span>detected storage sites from aerial imagery</span>
      </div>

      <div className="search-wrap" ref={containerRef}>
        <form className="search-form" onSubmit={handleSubmit} autoComplete="off">
          <input
            className="search-input"
            type="text"
            placeholder="Search a town or county…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
          />
          <button className="search-btn" type="submit" disabled={searching}>
            Search
          </button>
        </form>

        {open && (
          <div className="suggest-dropdown">
            {loadingSuggestions && (
              <div className="suggest-status">Searching…</div>
            )}
            {!loadingSuggestions &&
              suggestions.map((result, i) => (
                <div
                  key={`${result.place_id}`}
                  className={`suggest-item${i === activeIndex ? " active" : ""}`}
                  onMouseDown={() => pickSuggestion(result)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <span className="suggest-main">{shortLabel(result)}</span>
                  <span className="suggest-type mono">
                    {result.type === "county" ? "county" : "town"}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="status mono">
        {hoveredCounty ? (
          <>
            <b>{hoveredCounty.name} County{hoveredCounty.state ? `, ${hoveredCounty.state}` : ""}</b>
          </>
        ) : (
          "hover a county"
        )}
      </div>
      {error && <div className="search-error">{error}</div>}
    </div>
  );
}
