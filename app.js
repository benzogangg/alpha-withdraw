"use strict";
// Alpha.art offer withdraw. Finds every open Alpha.art offer made by your wallet and cancels them.
// The transactions are built here, in the open: only Alpha.art "Cancel Bid" instructions (data 04),
// each returning the offer's full SOL balance to your own wallet. Alpha.art's website is gone, but
// its on-chain program still lets the bidder cancel.

const W = solanaWeb3;
const ALPHA = new W.PublicKey("HZaWndaNWHFDd9Dhk5pqUUtsmoBCqzb1MLu3NAh1VX6B"); // Alpha.art program
const OFFER_SIZE = 85;             // offer account: [0] tag=1, [1] bidder @1, mint @33, price u64 @65
const PER_TX = 10;                 // cancels per transaction (each ix is tiny: 2 accounts, 1 byte)
const RPCS  = ["https://solana-rpc.publicnode.com", "https://solana-mainnet.gateway.tatum.io",
               "https://api.mainnet-beta.solana.com"]; // same list as the CSP

const $ = id => document.getElementById(id);
let conn, provider, owner, offers = [];

// Status text is always set as plain text; links are built only from signatures we got back.
function log(text, cls, links) {
  const el = $("log");
  el.textContent = "";
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text;
  el.appendChild(span);
  for (const l of links || []) {
    const a = document.createElement("a");
    a.href = l.href; a.textContent = l.text; a.target = "_blank"; a.rel = "noopener noreferrer";
    el.appendChild(document.createTextNode("\n"));
    el.appendChild(a);
  }
}

function setSim(text, cls) {
  const s = document.createElement("span");
  s.className = cls; s.textContent = text;
  $("sim").replaceChildren(s);
}

const sol = l => (l / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9 }) + " SOL";
const short = s => s.slice(0, 4) + "…" + s.slice(-4);

const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

// Try each public RPC (twice over), keep the first that answers. Any later error drops it (conn = null),
// so the next button press starts over and can fall back to another RPC.
async function rpc() {
  if (conn) return conn;
  for (let round = 0; round < 2; round++)
    for (const u of RPCS) {
      try { const c = new W.Connection(u, "confirmed"); await timeout(c.getLatestBlockhash(), 8000); return (conn = c); }
      catch (e) { console.warn("RPC", u, e); }
    }
  throw new Error("could not connect to a Solana RPC. Check your connection, turn off ad/privacy blockers for this page and try again.");
}

// Public RPCs refuse to search the Alpha.art program from a browser, so offers.json (built by
// build_index.py) says which accounts to look at. Each one is re-read on-chain here and kept
// only if it is still a live Alpha.art offer whose bidder (@1) is this wallet.
let index;
async function findOffers(pk) {
  if (!index) {
    index = await (await fetch("offers.json", { cache: "no-store" })).json();
    $("indexNote").textContent = "Offer list updated " + index.generated.replace("T", " ")
      + ". Offers made after that are not shown yet.";
  }
  const keys = (index.bidders[pk.toBase58()] || []).map(k => new W.PublicKey(k));
  const c = await rpc(), out = [];
  for (let i = 0; i < keys.length; i += 10) {           // publicnode serves at most 10 per call
    const infos = await c.getMultipleAccountsInfo(keys.slice(i, i + 10), "confirmed");
    infos.forEach((a, j) => {
      if (!a || !a.owner.equals(ALPHA) || a.data.length !== OFFER_SIZE) return;  // closed or not an offer
      const d = a.data;
      if (!new W.PublicKey(d.slice(1, 33)).equals(pk)) return;                    // not this wallet's offer
      out.push({ offer: keys[i + j], lamports: a.lamports, mint: new W.PublicKey(d.slice(33, 65)) });
    });
  }
  out.sort((a, b) => b.lamports - a.lamports);
  return out;
}

function cancelIx(pk, o) {
  return new W.TransactionInstruction({ programId: ALPHA, data: Uint8Array.of(4), keys: [
    { pubkey: pk, isSigner: true, isWritable: true },        // bidder: signs, receives the SOL
    { pubkey: o.offer, isSigner: false, isWritable: true },  // offer: closed
  ]});
}

function chunks(list) {
  const out = [];
  for (let i = 0; i < list.length; i += PER_TX) out.push(list.slice(i, i + PER_TX));
  return out;
}

async function simulate(pk, group) {
  const c = await rpc();
  const { blockhash } = await c.getLatestBlockhash("confirmed");
  const msg = new W.TransactionMessage({ payerKey: pk, recentBlockhash: blockhash,
    instructions: group.map(o => cancelIx(pk, o)) }).compileToLegacyMessage();
  const sim = await c.simulateTransaction(new W.VersionedTransaction(msg),
    { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  if (sim.value.err) console.log(sim.value.logs);
  return sim.value.err;
}

function offerRow(o) {
  const row = document.createElement("div"); row.className = "row";
  const a = document.createElement("a");
  a.href = "https://solscan.io/account/" + o.offer.toBase58();
  a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "mono";
  a.textContent = "offer " + short(o.offer.toBase58()) + " · NFT " + short(o.mint.toBase58());
  const v = document.createElement("span"); v.textContent = sol(o.lamports);
  row.append(a, v);
  return row;
}

function showOffers(list) {
  $("offers").replaceChildren(...list.map(offerRow));
}

async function inspect(pk) {
  const list = await findOffers(pk);
  const total = list.reduce((s, o) => s + o.lamports, 0);
  $("count").textContent = String(list.length);
  $("amount").textContent = list.length ? sol(total) : "—";
  showOffers(list);
  if (!list.length) { setSim("no open offers", "bad"); return { list, ok: false }; }
  for (const g of chunks(list)) {
    const err = await simulate(pk, g);
    if (err) { setSim("error: " + JSON.stringify(err), "bad"); return { list, ok: false, err }; }
  }
  setSim("passes ✓", "ok");
  return { list, ok: true };
}

// Last check before the wallet sees a transaction: only Alpha.art Cancel Bid instructions,
// each for an offer this wallet made, receiving the SOL to this wallet.
function assertSafe(tx, pk) {
  const byKey = new Map(offers.map(o => [o.offer.toBase58(), o]));
  const ok = tx.feePayer.equals(pk) && tx.instructions.length > 0 && tx.instructions.every(ix => {
    const k = ix.keys, o = k.length === 2 && byKey.get(k[1].pubkey.toBase58());
    return o && ix.programId.equals(ALPHA) && ix.data.length === 1 && ix.data[0] === 4
      && k[0].pubkey.equals(pk) && k[0].isSigner && k[0].isWritable && k[1].isWritable;
  });
  if (!ok) throw new Error("safety check failed, transaction not sent");
}

function pickProvider() {
  return window.phantom?.solana || window.solflare || window.backpack || window.solana || null;
}

$("connect").onclick = async () => {
  try {
    provider = pickProvider();
    if (!provider) { log("No wallet found. Open this page in a browser with Phantom/Solflare, or in your wallet app's built-in browser.", "bad"); return; }
    const r = await provider.connect();
    owner = new W.PublicKey((r && r.publicKey) || provider.publicKey);
    $("wallet").textContent = owner.toBase58();
    log("Looking for your Alpha.art offers…");
    const s = await inspect(owner);
    offers = s.list;
    const n = chunks(offers).length;
    const bal = await (await rpc()).getBalance(owner);
    if (!offers.length) log("This wallet has no open Alpha.art offers.", "bad");
    else if (!s.ok) log("Simulation failed — do not sign. Details are in the browser console.", "bad");
    else if (bal < 10000 * n) log("Not enough SOL in the wallet for the network fee (need ~" + sol(5000 * n) + ").", "bad");
    else {
      log("Ready: press “Withdraw”. " + (n > 1 ? "Your wallet will ask you to approve " + n + " transactions." : "Your wallet will show that you receive the amount above."));
      $("withdraw").disabled = false;
    }
  } catch (e) { conn = null; log("Error: " + (e.message || e), "bad"); }
};

$("withdraw").onclick = async () => {
  $("withdraw").disabled = true;
  try {
    const c = await rpc();
    const s = await inspect(owner);               // fresh list and simulation right before signing
    offers = s.list;
    if (!s.ok) throw new Error(offers.length ? "simulation failed: " + JSON.stringify(s.err) : "no open offers");
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
    const txs = chunks(offers).map(g => {
      const tx = new W.Transaction({ feePayer: owner, blockhash, lastValidBlockHeight });
      tx.add(...g.map(o => cancelIx(owner, o)));
      assertSafe(tx, owner);
      return tx;
    });
    log("Approve " + (txs.length > 1 ? "the " + txs.length + " transactions" : "the transaction") + " in your wallet…");
    const sigs = [];
    if (txs.length > 1 && provider.signAllTransactions) {
      const signed = await provider.signAllTransactions(txs);
      for (const t of signed) sigs.push(await c.sendRawTransaction(t.serialize()));
    } else {
      for (const tx of txs) {
        if (provider.signAndSendTransaction) { const r = await provider.signAndSendTransaction(tx); sigs.push(r.signature || r); }
        else sigs.push(await c.sendRawTransaction((await provider.signTransaction(tx)).serialize()));
      }
    }
    log("Sent, waiting for confirmation…");
    for (const sig of sigs) {
      const res = await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw new Error("transaction failed: " + JSON.stringify(res.value.err) + "\n" + sig);
    }
    const total = offers.reduce((t, o) => t + o.lamports, 0);
    log("Done ✓ " + sol(total) + " is now in your wallet.", "ok",
        sigs.map((g, i) => ({ href: "https://solscan.io/tx/" + encodeURIComponent(g), text: "View on Solscan" + (sigs.length > 1 ? " (" + (i + 1) + ")" : "") })));
    offers = (await inspect(owner)).list;
  } catch (e) {
    conn = null;
    log("Error: " + (e.message || e), "bad");
    $("withdraw").disabled = false;
  }
};

$("probeBtn").onclick = async () => {
  try {
    const pk = new W.PublicKey($("probe").value.trim());
    $("wallet").textContent = pk.toBase58() + " (read-only)";
    log("Checking…");
    const s = await inspect(pk);
    log(s.ok ? "Withdrawing these offers passes simulation. Only the wallet's owner can sign it."
             : s.list.length ? "Simulation failed." : "No open Alpha.art offers for this wallet.", s.ok ? "ok" : "bad");
  } catch (e) { conn = null; log("Error: " + (e.message || e), "bad"); }
};
