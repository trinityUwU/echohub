#!/usr/bin/env python3
"""
reddit_hunt.py — trouve les meilleurs fils r/LocalLLaMA pour commenter
Filtre : posts récents, peu de commentaires, sujets d'expertise
"""

import urllib.request
import json
import time
from datetime import datetime, timezone

SUBREDDIT = "LocalLLaMA"
USER_AGENT = "Mozilla/5.0 EchoHub-research/1.0"

KEYWORDS = [
    "tok/s", "tokens per second", "tokens/s",
    "ollama", "ollama slow", "ollama performance",
    "llama.cpp", "llama cpp", "llamacpp",
    "vllm", "vram", "oom", "out of memory",
    "flash attention", "flash_attn",
    "n_gpu_layers", "n_batch",
    "gguf", "awq", "gptq", "quantiz",
    "rtx 3060", "rtx 3090", "rtx 4090",
    "lm studio", "lmstudio",
    "inference", "performance", "slow",
    "cuda", "gpu offload",
    "migrate", "alternative",
]

SKIP_KEYWORDS = [
    "meme", "meme", "rant", "shower thought",
    "weekly", "megathread", "daily",
]

MAX_AGE_HOURS = 48
MAX_COMMENTS = 40
MIN_SCORE = 3


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def score_post(post):
    """Score un post selon sa pertinence — plus c'est élevé, mieux c'est."""
    title = post["title"].lower()
    text = (post.get("selftext") or "").lower()
    combined = title + " " + text

    score = 0

    # Keyword match
    matched = [k for k in KEYWORDS if k in combined]
    score += len(matched) * 10

    # Titre seul = meilleur signal
    title_matches = [k for k in KEYWORDS if k in title]
    score += len(title_matches) * 5

    # Peu de commentaires = moins de concurrence
    nc = post["num_comments"]
    if nc == 0:
        score += 20
    elif nc <= 5:
        score += 15
    elif nc <= 15:
        score += 10
    elif nc <= 30:
        score += 5
    else:
        score -= 10

    # Post récent = plus de visibilité
    age_h = (datetime.now(timezone.utc).timestamp() - post["created_utc"]) / 3600
    if age_h <= 2:
        score += 25
    elif age_h <= 6:
        score += 15
    elif age_h <= 12:
        score += 10
    elif age_h <= 24:
        score += 5

    # Upvotes faibles mais positifs = encore en train de monter
    if 5 <= post["score"] <= 50:
        score += 10

    return score, matched


def hunt(sort="new", limit=100):
    url = f"https://www.reddit.com/r/{SUBREDDIT}/{sort}.json?limit={limit}"
    data = fetch(url)
    posts = data["data"]["children"]

    now = datetime.now(timezone.utc).timestamp()
    results = []

    for p in posts:
        d = p["data"]

        # Filtres durs
        age_h = (now - d["created_utc"]) / 3600
        if age_h > MAX_AGE_HOURS:
            continue
        if d["num_comments"] > MAX_COMMENTS:
            continue
        if d["score"] < MIN_SCORE:
            continue
        if d.get("stickied"):
            continue

        title_lower = d["title"].lower()
        if any(sk in title_lower for sk in SKIP_KEYWORDS):
            continue

        relevance, matched = score_post(d)
        if relevance <= 0:
            continue

        results.append({
            "title": d["title"],
            "url": f"https://reddit.com{d['permalink']}",
            "score": d["score"],
            "comments": d["num_comments"],
            "age_h": round(age_h, 1),
            "relevance": relevance,
            "matched": matched,
            "selftext": (d.get("selftext") or "")[:300],
        })

    results.sort(key=lambda x: x["relevance"], reverse=True)
    return results


def main():
    print(f"Scanning r/{SUBREDDIT} — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")

    # Fetch new + hot pour couvrir les deux
    new_posts = hunt("new", 100)
    hot_posts = hunt("hot", 50)

    # Merge + deduplicate
    seen = set()
    all_posts = []
    for p in new_posts + hot_posts:
        if p["url"] not in seen:
            seen.add(p["url"])
            all_posts.append(p)

    all_posts.sort(key=lambda x: x["relevance"], reverse=True)
    top = all_posts[:10]

    if not top:
        print("Aucun fil pertinent trouvé pour le moment.")
        return

    print(f"Top {len(top)} fils à commenter :\n")
    print("=" * 80)

    for i, p in enumerate(top, 1):
        age_str = f"{p['age_h']}h"
        print(f"[{i}] {p['title']}")
        print(f"    {p['url']}")
        print(f"    ↑{p['score']}  💬{p['comments']}  ⏱{age_str}  relevance:{p['relevance']}")
        print(f"    Keywords: {', '.join(p['matched'][:5])}")
        if p["selftext"]:
            print(f"    OP: {p['selftext'][:150].strip()}...")
        print()


if __name__ == "__main__":
    main()
