
"use strict";

/*
 * Pokérole Shiny Roulette
 * Foundry VTT v13
 * Versione iniziale 1.0.0
 *
 * Il GM autorizza un giocatore.
 * Tutti vedono la roulette.
 * Il risultato viene deciso dal GM.
 * Probabilità iniziale: 1/800.
 * Dopo ogni shiny: 1/1600, 1/3200, ecc.
 */

const SHINY_MODULE = "pokerole-shiny-roulette";
const SHINY_SOCKET = `module.${SHINY_MODULE}`;
const SHINY_DURATION = 6000;

let shinySession = null;
let shinyDialog = null;
let shinyBusy = false;

function shinyNotify(message, type = "info") {
  ui.notifications[type](message);
}

function shinyIsGM() {
  return game.user?.isGM === true;
}

function shinyCurrentOdds() {
  return game.settings.get(SHINY_MODULE, "denominator");
}

function shinyUsers() {
  return game.users.filter(user => user.active && !user.isGM);
}

function shinyEscape(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function shinyGetActor(session) {
  return game.actors.get(session.actorId) ?? null;
}

function shinyGetPlayer(session) {
  return game.users.get(session.playerId) ?? null;
}

function shinyBroadcast(data) {
  game.socket.emit(SHINY_SOCKET, data);
}

function shinyCloseDialog() {
  if (shinyDialog?.rendered) {
    shinyDialog.close();
  }
  shinyDialog = null;
}

function shinyRenderHTML(session) {
  const player = shinyGetPlayer(session);
  const actor = shinyGetActor(session);

  const playerName = shinyEscape(player?.name ?? "Allenatore");
  const pokemonName = shinyEscape(
    actor?.name ?? session.actorName ?? "Pokémon"
  );

  const canSpin =
    game.user.id === session.playerId &&
    session.status === "ready";

  const buttonText =
    session.status === "spinning"
      ? "LA RUOTA STA GIRANDO..."
      : session.status === "finished"
        ? "ESTRAZIONE COMPLETATA"
        : canSpin
          ? "GIRA LA RUOTA!"
          : `IN ATTESA DI ${playerName}`;

  return `
    <section class="psr-app">
      <div class="psr-stars">✦ ✧ ✦</div>
      <div class="psr-kicker">POKÉROLE</div>
      <h1 class="psr-heading">SHINY ROULETTE</h1>
      <div class="psr-pokemon">${pokemonName}</div>

      <div class="psr-stage">
        <div class="psr-pointer">▼</div>
        <div class="psr-wheel" id="psr-wheel">
          <div class="psr-wheel-inner">
            <span class="psr-wheel-symbol">✦</span>
            <span class="psr-wheel-label">SHINY?</span>
          </div>
        </div>
      </div>

      <div class="psr-odds">
        PROBABILITÀ ATTUALE
        <strong>1 / ${session.denominator.toLocaleString("it-IT")}</strong>
      </div>

      <div class="psr-player">
        ALLENATORE SELEZIONATO
        <strong>${playerName}</strong>
      </div>

      <button
        type="button"
        class="psr-spin-button"
        id="psr-spin-button"
        ${canSpin ? "" : "disabled"}
      >${buttonText}</button>

      <div class="psr-result" id="psr-result">
        ${session.status === "finished"
          ? session.isShiny
            ? "✨ SHINY TROVATO! ✨"
            : "NON È SHINY. RITENTA!"
          : "La fortuna sta per decidere..."}
      </div>
    </section>
  `;
}

function shinyOpenDialog(session) {
  shinyCloseDialog();

  shinyDialog = new Dialog({
    title: "✦ Pokérole Shiny Roulette ✦",
    content: shinyRenderHTML(session),
    buttons: {},
    close: () => {
      shinyDialog = null;
    },
    render: html => {
      const element = html[0];
      const button = element.querySelector("#psr-spin-button");

      button?.addEventListener("click", () => {
        shinyRequestSpin();
      });

      if (session.status === "spinning") {
        shinyAnimate();
      }

      if (session.status === "finished") {
        shinyShowResult(session.isShiny);
      }
    }
  }, {
    width: 550,
    height: "auto",
    resizable: false,
    classes: ["pokerole-shiny-dialog"]
  });

  shinyDialog.render(true);
}

function shinyAnimate() {
  const wheel = shinyDialog?.element?.[0]
    ?.querySelector("#psr-wheel");

  const result = shinyDialog?.element?.[0]
    ?.querySelector("#psr-result");

  const button = shinyDialog?.element?.[0]
    ?.querySelector("#psr-spin-button");

  if (wheel) {
    wheel.classList.remove("psr-spinning");
    void wheel.offsetWidth;
    wheel.classList.add("psr-spinning");
  }

  if (result) {
    result.textContent = "✦ IL DESTINO STA GIRANDO ✦";
    result.className = "psr-result";
  }

  if (button) {
    button.disabled = true;
    button.textContent = "LA RUOTA STA GIRANDO...";
  }
}

function shinyShowResult(isShiny) {
  const element = shinyDialog?.element?.[0];
  if (!element) return;

  const result = element.querySelector("#psr-result");
  const wheel = element.querySelector("#psr-wheel");

  if (wheel) {
    wheel.classList.remove("psr-spinning");
    wheel.classList.toggle("psr-success", isShiny);
  }

  if (result) {
    result.textContent = isShiny
      ? "✨ SHINY TROVATO! ✨"
      : "NON È SHINY. RITENTA!";

    result.className =
      "psr-result " +
      (isShiny ? "psr-result-shiny" : "psr-result-normal");
  }
}

function shinyRequestSpin() {
  if (!shinySession) return;

  if (game.user.id !== shinySession.playerId) {
    shinyNotify("Solo il giocatore autorizzato può girare.", "warn");
    return;
  }

  if (shinySession.status !== "ready") {
    shinyNotify("Questa estrazione non è disponibile.", "warn");
    return;
  }

  shinySession.status = "pending";

  const button = shinyDialog?.element?.[0]
    ?.querySelector("#psr-spin-button");

  if (button) {
    button.disabled = true;
    button.textContent = "RICHIESTA INVIATA AL GM...";
  }

  const request = {
    type: "spin-request",
    sessionId: shinySession.id,
    senderId: game.user.id
  };

  if (shinyIsGM()) {
    shinyHandleSpinRequest(request);
  } else {
    shinyBroadcast(request);
  }
}

async function shinyHandleSpinRequest(message) {
  if (!shinyIsGM()) return;
  if (!shinySession || shinyBusy) return;

  if (message.sessionId !== shinySession.id) return;
  if (message.senderId !== shinySession.playerId) return;
  if (shinySession.status !== "ready") return;

  shinyBusy = true;
  shinySession.status = "spinning";

  const denominator = shinyCurrentOdds();

  // Il tiro avviene soltanto sul client del GM.
  const roll = Math.floor(Math.random() * denominator) + 1;
  const isShiny = roll === 1;

  shinyBroadcast({
    type: "spin-start",
    sessionId: shinySession.id
  });

  shinyAnimate();

  await new Promise(resolve =>
    setTimeout(resolve, SHINY_DURATION)
  );

  const actor = shinyGetActor(shinySession);

  if (isShiny && actor) {
    try {
      await actor.setFlag(SHINY_MODULE, "isShiny", true);
      await actor.setFlag(
        SHINY_MODULE,
        "shinyFoundAt",
        new Date().toISOString()
      );

      const newDenominator = denominator * 2;

      await game.settings.set(
        SHINY_MODULE,
        "denominator",
        newDenominator
      );
    } catch (error) {
      console.error("Shiny Roulette | Errore salvataggio:", error);
      shinyNotify(
        "Shiny estratto, ma il salvataggio non è riuscito. Controlla la console.",
        "error"
      );
    }
  }

  shinySession.status = "finished";
  shinySession.isShiny = isShiny;

  shinyBroadcast({
    type: "spin-result",
    sessionId: shinySession.id,
    isShiny,
    pokemonName: shinySession.actorName,
    denominator
  });

  shinyShowResult(isShiny);

  if (isShiny) {
    ChatMessage.create({
      content: `
        <div style="text-align:center">
          <h2>✨ SHINY TROVATO! ✨</h2>
          <p><strong>${shinyEscape(shinySession.actorName)}</strong></p>
          <p>Probabilità: 1/${denominator}</p>
        </div>
      `
    });
  }

  shinyBusy = false;
}

function shinyHandleSocket(message) {
  if (!message?.type) return;

  switch (message.type) {
    case "session-open": {
      if (!message.session?.id) return;

      shinySession = {
        ...message.session,
        status: "ready"
      };

      shinyOpenDialog(shinySession);
      break;
    }

    case "spin-request": {
      if (!shinyIsGM()) return;
      if (message.senderId === game.user.id) return;

      shinyHandleSpinRequest(message);
      break;
    }

    case "spin-start": {
      if (!shinySession) return;
      if (message.sessionId !== shinySession.id) return;

      shinySession.status = "spinning";
      shinyAnimate();
      break;
    }

    case "spin-result": {
      if (!shinySession) return;
      if (message.sessionId !== shinySession.id) return;

      shinySession.status = "finished";
      shinySession.isShiny = message.isShiny;

      shinyShowResult(message.isShiny);
      break;
    }
  }
}

async function shinyOpenGM() {
  if (!shinyIsGM()) {
    shinyNotify("Solo il GM può avviare una roulette.", "warn");
    return;
  }

  if (shinyBusy || shinySession?.status === "ready" ||
      shinySession?.status === "spinning") {
    shinyNotify(
      "C'è già una roulette attiva. Completa quella prima di aprirne un'altra.",
      "warn"
    );
    return;
  }

  const token = canvas.tokens.controlled[0];

  if (!token) {
    shinyNotify(
      "Seleziona prima il token del Pokémon sulla scena.",
      "warn"
    );
    return;
  }

  if (canvas.tokens.controlled.length !== 1) {
    shinyNotify(
      "Seleziona un solo token Pokémon.",
      "warn"
    );
    return;
  }

  const actor = token.actor;

  if (!actor) {
    shinyNotify("Il token non ha un Actor associato.", "error");
    return;
  }

  const players = shinyUsers();

  if (!players.length) {
    shinyNotify(
      "Non ci sono giocatori collegati.",
      "warn"
    );
    return;
  }

  const options = players.map(player => `
    <option value="${shinyEscape(player.id)}">
      ${shinyEscape(player.name)}
    </option>
  `).join("");

  new Dialog({
    title: "🎡 Prepara Shiny Roulette",
    content: `
      <div class="psr-setup">
        <p><strong>Pokémon:</strong> ${shinyEscape(actor.name)}</p>
        <p><strong>Probabilità:</strong> 1/${shinyCurrentOdds()}</p>
        <div class="form-group">
          <label>Giocatore autorizzato</label>
          <select id="psr-player-select">${options}</select>
        </div>
        <p>La roulette apparirà a tutti i giocatori collegati.</p>
      </div>
    `,
    buttons: {
      start: {
        icon: '<i class="fas fa-play"></i>',
        label: "Apri la roulette",
        callback: html => {
          const playerId = html.find("#psr-player-select").val();

          if (!game.users.get(playerId)?.active) {
            shinyNotify("Giocatore non disponibile.", "warn");
            return;
          }

          shinySession = {
            id: foundry.utils.randomID(),
            actorId: actor.id,
            actorName: actor.name,
            playerId,
            denominator: shinyCurrentOdds(),
            status: "ready",
            isShiny: false
          };

          shinyBroadcast({
            type: "session-open",
            session: shinySession
          });

          shinyOpenDialog(shinySession);
        }
      },
      cancel: {
        label: "Annulla"
      }
    },
    default: "start"
  }).render(true);
}

Hooks.once("init", () => {
  game.settings.register(SHINY_MODULE, "denominator", {
    name: "Probabilità Shiny",
    hint: "Denominatore condiviso della probabilità shiny.",
    scope: "world",
    config: true,
    type: Number,
    default: 800,
    range: {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      step: 1
    }
  });
});

Hooks.once("ready", () => {
  game.socket.on(SHINY_SOCKET, shinyHandleSocket);

  const module = game.modules.get(SHINY_MODULE);

  if (module) {
    module.api = {
      open: shinyOpenGM,
      getOdds: shinyCurrentOdds,
      isShiny: actor =>
        actor?.getFlag(SHINY_MODULE, "isShiny") === true
    };
  }

  console.log("Pokérole Shiny Roulette | Modulo pronto");
});
