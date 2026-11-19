# Deploy guard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or implement in-session). Steps use LoveRussian fix-loop for ship.

**Goal:** Fail closed after deploy if OpenAI/proxy/AUDIT_SMOKE unhealthy.

**Architecture:** Health enrichment + shared bash guard; deploys call guard after pm2 restart.

**Tech stack:** Node Express health, bash + python3 on VPS, existing PROXY_LIST env.

### Task 1: Export readiness + health fields
- Export `isOpenAiClientReady` / socks count helper from `aiResponder.js`
- Extend `/api/health` in `server.js`
- Smoke asserts shape

### Task 2: `_deploy_guard.sh`
- Scrub AUDIT_SMOKE from dump
- PROXY≥5, pm2 online, health JSON gates, optional openai log sniff
- Wire `_deploy_0le.sh`

### Task 3: Changelog + skill + ship
- Dual updates + CHANGELOG 0le + loverussian-deploy note
- Deploy, PROXY≥5, post-add audit A
