"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useMedia } from "@/lib/useMedia";
import { cn } from "@/lib/cn";

export interface CarouselSlide {
  id: string;
  label: string;
  node: ReactNode;
}

// Di bawah xl: satu kartu yang bisa digeser (sentuh/seret/keyboard) dan berganti otomatis.
// Di xl ke atas: grid tiga kartu berdampingan, carousel tidak aktif.
export function SummaryCarousel({ slides, interval = 8000 }: { slides: CarouselSlide[]; interval?: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const slideEls = useRef<(HTMLDivElement | null)[]>([]);
  const innerEls = useRef<(HTMLDivElement | null)[]>([]);
  const raf = useRef(0);
  const drag = useRef({ down: false, startX: 0, startLeft: 0, moved: false });

  const [active, setActive] = useState(0);
  const [cycle, setCycle] = useState(0); // naik tiap kali geser otomatis dilanjutkan, agar progres mulai dari 0
  const [hovered, setHovered] = useState(false);
  const [touching, setTouching] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);

  const wide = useMedia("(min-width: 1280px)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const n = slides.length;
  const paused = hovered || touching || focused || hidden;
  const auto = !wide && !reduced && n > 1;

  const goTo = useCallback(
    (i: number) => {
      const el = scroller.current;
      const target = slideEls.current[(i + n) % n];
      if (!el || !target) return;
      el.scrollTo({ left: target.offsetLeft, behavior: reduced ? "auto" : "smooth" });
    },
    [n, reduced],
  );

  // Animasi kartu mengikuti posisi geser: kartu yang menjauh mengecil dan memudar.
  const update = useCallback(() => {
    raf.current = 0;
    const el = scroller.current;
    if (!el) return;
    let best = 0;
    let bestDist = Infinity;
    slideEls.current.forEach((s, i) => {
      if (!s) return;
      const d = (s.offsetLeft - el.scrollLeft) / el.clientWidth;
      const a = Math.abs(d);
      if (a < bestDist) {
        bestDist = a;
        best = i;
      }
      const inner = innerEls.current[i];
      if (!inner) return;
      if (wide || reduced) {
        inner.style.transform = "";
        inner.style.opacity = "";
      } else {
        const k = Math.min(1, a);
        inner.style.transform = `translateX(${(-d * 14).toFixed(1)}px) scale(${(1 - 0.06 * k).toFixed(3)})`;
        inner.style.opacity = String((1 - 0.65 * k).toFixed(3));
      }
    });
    setActive(best);
  }, [wide, reduced]);

  const onScroll = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(update);
  }, [update]);

  useEffect(() => {
    update();
  }, [update]);

  useEffect(() => {
    const onVis = () => {
      const h = document.visibilityState === "hidden";
      setHidden(h);
      if (!h) setCycle((c) => c + 1);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Geser otomatis: tiap `interval` ms, dimulai ulang setiap kartu berganti atau dilanjutkan dari jeda.
  useEffect(() => {
    if (!auto || paused) return;
    const id = setTimeout(() => goTo((active + 1) % n), interval);
    return () => clearTimeout(id);
  }, [auto, paused, active, cycle, n, interval, goTo]);

  const resume = () => setCycle((c) => c + 1);

  // Seret dengan mouse (sentuhan sudah ditangani scroll bawaan browser)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scroller.current;
    if (!el || wide || e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = { down: true, startX: e.clientX, startLeft: el.scrollLeft, moved: false };
    el.style.scrollSnapType = "none";
    el.style.userSelect = "none";
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - drag.current.startX;
      if (Math.abs(dx) > 5) drag.current.moved = true;
      el.scrollLeft = drag.current.startLeft - dx;
    };
    const up = (ev: PointerEvent) => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      const dx = ev.clientX - drag.current.startX;
      drag.current.down = false;
      el.style.scrollSnapType = "";
      el.style.userSelect = "";
      let target = active;
      if (dx < -40) target = Math.min(n - 1, active + 1);
      else if (dx > 40) target = Math.max(0, active - 1);
      goTo(target);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (wide) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(Math.min(n - 1, active + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(Math.max(0, active - 1));
    }
  };

  return (
    <div>
      <div
        ref={scroller}
        role="region"
        aria-roledescription="carousel"
        aria-label="Ringkasan panel"
        tabIndex={wide ? -1 : 0}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onClickCapture={(e) => {
          if (drag.current.moved) {
            e.preventDefault();
            e.stopPropagation();
            drag.current.moved = false;
          }
        }}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") {
            setHovered(false);
            resume();
          }
        }}
        onTouchStart={() => setTouching(true)}
        onTouchEnd={() => {
          setTouching(false);
          resume();
        }}
        onTouchCancel={() => setTouching(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          resume();
        }}
        className={cn(
          "relative flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "cursor-grab active:cursor-grabbing xl:grid xl:cursor-auto xl:grid-cols-3 xl:gap-5 xl:overflow-visible",
        )}
      >
        {slides.map((s, i) => (
          <div
            key={s.id}
            ref={(el) => {
              slideEls.current[i] = el;
            }}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} dari ${n}: ${s.label}`}
            className="w-full shrink-0 snap-center xl:w-auto"
          >
            <div
              ref={(el) => {
                innerEls.current[i] = el;
              }}
              className="h-full will-change-transform"
            >
              {s.node}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
