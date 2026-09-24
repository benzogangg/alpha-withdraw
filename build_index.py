#!/usr/bin/env python3
"""Build offers.json: every open Alpha.art offer, grouped by bidder (address at offset 1).
The page only uses it to know which accounts to look at; it re-reads each one on-chain
and checks program, size and bidder before building anything."""
import base64, datetime, json, subprocess

RPC = "https://api.mainnet-beta.solana.com"
ALPHA = "HZaWndaNWHFDd9Dhk5pqUUtsmoBCqzb1MLu3NAh1VX6B"
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

def b58(b):
    n = int.from_bytes(b, "big"); s = ""
    while n: n, r = divmod(n, 58); s = B58[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s

body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "getProgramAccounts", "params": [ALPHA,
    {"encoding": "base64", "dataSlice": {"offset": 0, "length": 33}, "filters": [{"dataSize": 85}]}]}).encode()
raw = subprocess.run(["curl", "-s", "-m", "180", RPC, "-H", "content-type: application/json", "--data-binary", "@-"],
                     input=body, capture_output=True, check=True).stdout
res = json.loads(raw)["result"]
bidders = {}
for a in sorted(res, key=lambda a: -a["account"]["lamports"]):
    d = base64.b64decode(a["account"]["data"][0])
    bidders.setdefault(b58(d[1:33]), []).append(a["pubkey"])
out = {"generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
       "offers": len(res), "bidders": dict(sorted(bidders.items()))}
json.dump(out, open("offers.json", "w"), separators=(",", ":"))
print(out["generated"], len(res), "offers,", len(bidders), "bidders,",
      round(sum(a["account"]["lamports"] for a in res) / 1e9, 3), "SOL")
