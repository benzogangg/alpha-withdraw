"use strict";
// Hyperspace escrow withdraw. The whole transaction is built here, in the open:
// one Withdraw instruction, from your escrow to your own wallet.

const W = solanaWeb3;
const HYPER = new W.PublicKey("HYPERfwdTjyJ2SCaKHmpF2MtrXqWxrsotYDsTrshHWq8"); // Hyperspace program
const AH    = new W.PublicKey("5pdaXth4ijgDCeYDKgSx3jAbN7m8h4gy1LRCErAAN1LM"); // Hyperspace auction house
const FEL   = new W.PublicKey("FEL1Z3EjUEbET9miT2p3S8qK1K11stCzN5KLaqZZ976d"); // auction-house authority; read-only, not a signer
const TOKEN = new W.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const RENT  = new W.PublicKey("SysvarRent111111111111111111111111111111111");
const DISC  = [0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22];              // sha256("global:withdraw")[0..8]
const RPCS  = ["https://solana-rpc.publicnode.com", "https://solana-mainnet.gateway.tatum.io",
               "https://api.mainnet-beta.solana.com"]; // same list as the CSP

const $ = id => document.getElementById(id);
let conn, provider, owner, state;

// Status text is always set as plain text; the only link is built from a signature we got back.
function log(text, cls, link) {
  const el = $("log");
  el.textContent = "";
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text;
  el.appendChild(span);
  if (link) {
    const a = document.createElement("a");
    a.href = link.href; a.textContent = link.text; a.target = "_blank"; a.rel = "noopener noreferrer";
    el.appendChild(document.createTextNode("\n"));
    el.appendChild(a);
  }
}

function setSim(text, cls) {
  const s = document.createElement("span");
  s.className = cls; s.textContent = text;
  $("sim").replaceChildren(s);
}

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

function escrowOf(pk) {
  return W.PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("hyperspace"), AH.toBytes(), pk.toBytes()], HYPER);
}

function withdrawIx(pk, esc, bump, lamports) {
  const data = new Uint8Array(17);
  data.set(DISC, 0); data[8] = bump;
  new DataView(data.buffer).setBigUint64(9, BigInt(lamports), true);
  return new W.TransactionInstruction({ programId: HYPER, data, keys: [
    { pubkey: pk, isSigner: true, isWritable: true },     // wallet
    { pubkey: pk, isSigner: true, isWritable: true },     // receiver = the same wallet
    { pubkey: esc, isSigner: false, isWritable: true },
    { pubkey: FEL, isSigner: false, isWritable: false },
    { pubkey: AH, isSigner: false, isWritable: false },
    { pubkey: TOKEN, isSigner: false, isWritable: false },
    { pubkey: W.SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: RENT, isSigner: false, isWritable: false },
  ]});
}

async function inspect(pk) {
  const c = await rpc();
  const [esc, bump] = escrowOf(pk);
  const lamports = await c.getBalance(esc, "confirmed");
  $("escrow").textContent = esc.toBase58();
  $("amount").textContent = (lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9 }) + " SOL";
  if (!lamports) { setSim("escrow is empty", "bad"); return { esc, bump, lamports, ok: false }; }
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  const msg = new W.TransactionMessage({ payerKey: pk, recentBlockhash: blockhash,
    instructions: [withdrawIx(pk, esc, bump, lamports)] }).compileToLegacyMessage();
  const sim = await c.simulateTransaction(new W.VersionedTransaction(msg),
    { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  const ok = !sim.value.err;
  if (ok) setSim("passes ✓", "ok");
  else { setSim("error: " + JSON.stringify(sim.value.err), "bad"); console.log(sim.value.logs); }
  return { esc, bump, lamports, ok, err: sim.value.err, blockhash, lastValidBlockHeight };
}

// Last check before the wallet sees the transaction: exactly one Hyperspace Withdraw,
// from this wallet's own escrow to this same wallet. Anything else is refused.
function assertSafe(tx, pk) {
  const [esc] = escrowOf(pk);
  const ixs = tx.instructions;
  const k = ixs.length === 1 && ixs[0].keys;
  const ok = k && ixs[0].programId.equals(HYPER)
    && DISC.every((b, i) => ixs[0].data[i] === b)
    && k.length === 8 && k[0].pubkey.equals(pk) && k[1].pubkey.equals(pk) && k[2].pubkey.equals(esc)
    && k.slice(3).every(x => !x.isSigner)
    && tx.feePayer.equals(pk);
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
    log("Checking escrow…");
    state = await inspect(owner);
    const bal = await (await rpc()).getBalance(owner);
    if (!state.lamports) log("The Hyperspace escrow for this wallet is empty.", "bad");
    else if (!state.ok) log("Simulation failed — do not sign. Details are in the browser console.", "bad");
    else if (bal < 10000) log("Not enough SOL in the wallet for the network fee (need ~0.00001 SOL).", "bad");
    else { log("Ready: press “Withdraw”. Your wallet will show that you receive the amount above."); $("withdraw").disabled = false; }
  } catch (e) { conn = null; log("Error: " + (e.message || e), "bad"); }
};

$("withdraw").onclick = async () => {
  $("withdraw").disabled = true;
  try {
    const c = await rpc();
    state = await inspect(owner);                 // fresh balance and blockhash right before signing
    if (!state.ok) throw new Error("simulation failed: " + JSON.stringify(state.err));
    const tx = new W.Transaction({ feePayer: owner, blockhash: state.blockhash,
      lastValidBlockHeight: state.lastValidBlockHeight }).add(withdrawIx(owner, state.esc, state.bump, state.lamports));
    assertSafe(tx, owner);
    log("Approve the transaction in your wallet…");
    let sig;
    if (provider.signAndSendTransaction) {
      const r = await provider.signAndSendTransaction(tx);
      sig = r.signature || r;
    } else {
      const signed = await provider.signTransaction(tx);
      sig = await c.sendRawTransaction(signed.serialize());
    }
    log("Sent, waiting for confirmation…\n" + sig);
    const res = await c.confirmTransaction({ signature: sig, blockhash: state.blockhash,
      lastValidBlockHeight: state.lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new Error("transaction failed: " + JSON.stringify(res.value.err));
    log("Done ✓ " + state.lamports / 1e9 + " SOL is now in your wallet.", "ok",
        { href: "https://solscan.io/tx/" + encodeURIComponent(sig), text: "View on Solscan" });
    await inspect(owner);
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
    log(s.ok ? "The withdrawal passes simulation for this wallet. Only its owner can sign it."
             : s.lamports ? "Simulation failed." : "Escrow is empty.", s.ok ? "ok" : "bad");
  } catch (e) { conn = null; log("Error: " + (e.message || e), "bad"); }
};
