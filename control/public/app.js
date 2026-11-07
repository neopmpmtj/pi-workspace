const page = document.body.dataset.page;
if (page === "landing") void initLanding();
if (page === "settings") void initSettings();

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value != null) node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function setStatus(node, message, kind) {
  node.textContent = message;
  node.className = `status ${kind || ""}`;
}

function initLanding() {
  const rows = document.getElementById("rows");
  const status = document.getElementById("landing-status");
  const startAll = document.getElementById("start-all");
  const stopAll = document.getElementById("stop-all");
  let busy = false;

  async function refresh() {
    const body = await request("/api/agents");
    render(body.agents);
  }

  function render(agents) {
    rows.replaceChildren();
    for (const agent of agents) {
      const state = agent.listening ? "listening" : "stopped";
      rows.append(el("article", { class: "card" }, [
        el("div", { class: "row" }, [
          el("div", {}, [
            el("h3", {}, [agent.name]),
            el("p", { class: "meta" }, [`${agent.provider} / ${agent.model} · port ${agent.port}`]),
          ]),
          el("span", { class: state }, [agent.listening ? "running" : "stopped"]),
        ]),
        el("div", { class: "actions" }, [
          el("button", { type: "button", onclick: () => act(`/api/agents/${agent.id}/start`) }, ["Start"]),
          el("button", { type: "button", onclick: () => act(`/api/agents/${agent.id}/stop`) }, ["Stop"]),
          el("button", { type: "button", onclick: () => act(`/api/agents/${agent.id}/open`) }, ["Open"]),
        ]),
      ]));
    }
  }

  async function act(url) {
    busy = true;
    setStatus(status, "Working.", "");
    try {
      const body = await request(url, { method: "POST" });
      await refresh();
      setStatus(status, body.error || "", body.error ? "error" : "");
    } catch (error) {
      setStatus(status, error.message, "error");
    } finally {
      busy = false;
    }
  }

  startAll.addEventListener("click", () => act("/api/agents/start-all"));
  stopAll.addEventListener("click", () => act("/api/agents/stop-all"));
  void refresh().catch((error) => setStatus(status, error.message, "error"));
  setInterval(() => { if (!busy) void refresh().catch(() => {}); }, 2000);
}

async function initSettings() {
  const main = document.getElementById("settings");
  const note = main.querySelector(".note");
  let plane;
  try {
    plane = await request("/api/settings");
  } catch (error) {
    main.append(el("p", { class: "status error" }, [error.message]));
    return;
  }
  // A file that could not be read is reported, not hidden: the page stays usable with the rest.
  for (const problem of plane.problems || []) {
    main.append(el("p", { class: "status error" }, [`${problem.file}: ${problem.message}`]));
  }
  main.append(section("Project gates", plane.gates.map(gateCard)));
  main.append(section("Input phrase", [plane.inputPhrase
    ? inputPhraseCard(plane.inputPhrase)
    : unreadableCard("Input phrase", "input-phrase-config.json")]));
  main.append(section("Prompt build", [plane.promptBuild
    ? promptBuildCard(plane.promptBuild)
    : unreadableCard("Prompt build", "prompt-build-config.json")]));
  main.append(section("Agents", plane.agents.map(agentCard)));
  if (note) main.prepend(note);
}

/** A card for a section whose file is missing or unreadable, with no form to submit. */
function unreadableCard(title, file) {
  return el("div", { class: "card" }, [
    el("h3", {}, [title]),
    el("p", { class: "status error" }, [`${file} could not be read — see the note at the top.`]),
  ]);
}

function section(title, cards) {
  return el("section", { class: "stack" }, [el("h2", {}, [title]), ...cards]);
}

function gateCard(gate) {
  const status = el("p", { class: "status" });
  const form = el("form", { class: "card" }, [
    el("h3", {}, [gate.name]),
    el("div", { class: "fields" }, gate.fields.map(fieldControl)),
    el("div", { class: "actions" }, [el("button", { type: "submit" }, ["Save"])]),
    status,
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = {};
    for (const input of form.querySelectorAll("[data-key]")) fields[input.dataset.key] = readControl(input);
    void save(form, status, `/api/settings/gates/${gate.name}`, { fields });
  });
  return form;
}

function enumSelect(field, options) {
  const select = el("select", { "data-key": field.key, "data-type": field.type }, options.map((value) => {
    const option = el("option", { value }, [value]);
    if (value === field.value) option.selected = true;
    return option;
  }));
  return el("label", {}, [field.key, select]);
}

function fieldControl(field) {
  if (field.type === "boolean") {
    return el("label", { class: "inline" }, [
      el("input", { type: "checkbox", "data-key": field.key, "data-type": "boolean", ...(field.value ? { checked: "checked" } : {}) }),
      field.key,
    ]);
  }
  if (field.type === "mode") return enumSelect(field, ["route", "dry"]);
  if (field.type === "answer") return enumSelect(field, ["model", "hook"]);
  const input = el("input", {
    "data-key": field.key,
    "data-type": field.type,
    type: field.type === "number" ? "number" : "text",
    value: field.value,
  });
  if (field.type === "number") input.min = "1";
  return el("label", {}, [field.key, input]);
}

function inputPhraseCard(phrase) {
  const status = el("p", { class: "status" });
  const form = el("form", { class: "card" }, [
    el("h3", {}, ["inputPhrase"]),
    el("label", { class: "inline" }, [
      el("input", { type: "checkbox", "data-key": "enabled", ...(phrase.enabled ? { checked: "checked" } : {}) }),
      "enabled",
    ]),
    el("label", {}, ["append1", el("input", { "data-key": "append1", type: "text", value: phrase.append1 })]),
    el("div", { class: "sub" }, [
      el("h3", {}, ["Option"]),
      ...phrase.options.map((option) => optionBlock(option)),
    ]),
    el("div", { class: "actions" }, [el("button", { type: "submit" }, ["Save"])]),
    status,
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const options = [...form.querySelectorAll("[data-option]")].map((block) => ({
      name: block.dataset.option,
      enabled: block.querySelector("[data-key='on']").checked,
      allowBlank: block.querySelector("[data-key='allowBlank']").checked,
      phrase: block.querySelector("[data-key='phrase']").value,
    }));
    void save(form, status, "/api/settings/input-phrase", {
      enabled: form.querySelector("[data-key='enabled']").checked,
      append1: form.querySelector("[data-key='append1']").value,
      options,
    });
  });
  return form;
}

function promptBuildCard(build) {
  const status = el("p", { class: "status" });
  const form = el("form", { class: "card" }, [
    el("h3", {}, ["promptBuild"]),
    el("label", { class: "inline" }, [
      el("input", { type: "checkbox", "data-key": "enabled", ...(build.enabled ? { checked: "checked" } : {}) }),
      "enabled",
    ]),
    el("div", { class: "sub" }, [
      el("h3", {}, ["Option"]),
      ...build.options.map((option) => promptBuildBlock(option)),
    ]),
    el("div", { class: "actions" }, [el("button", { type: "submit" }, ["Save"])]),
    status,
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const options = [...form.querySelectorAll("[data-option]")].map((block) => ({
      name: block.dataset.option,
      enabled: block.querySelector("[data-key='on']").checked,
      prompt: block.querySelector("[data-key='prompt']").value,
      config: block.querySelector("[data-key='config']").value,
    }));
    void save(form, status, "/api/settings/prompt-build", {
      enabled: form.querySelector("[data-key='enabled']").checked,
      options,
    });
  });
  return form;
}

function promptBuildBlock(option) {
  return el("fieldset", { class: "fields", "data-option": option.name }, [
    el("label", { class: "inline" }, [
      el("input", { type: "radio", name: "prompt-build-option", "data-key": "on", ...(option.enabled ? { checked: "checked" } : {}) }),
      option.name,
    ]),
    el("label", {}, ["prompt", el("textarea", { "data-key": "prompt" }, [option.prompt])]),
    el("label", {}, ["config", el("textarea", { "data-key": "config" }, [option.config])]),
  ]);
}

function optionBlock(option) {
  return el("fieldset", { class: "fields", "data-option": option.name }, [
    el("label", { class: "inline" }, [
      el("input", { type: "radio", name: "phrase-option", "data-key": "on", ...(option.enabled ? { checked: "checked" } : {}) }),
      option.name,
    ]),
    el("label", { class: "inline" }, [
      el("input", { type: "checkbox", "data-key": "allowBlank", ...(option.allowBlank ? { checked: "checked" } : {}) }),
      "allowBlank",
    ]),
    el("label", {}, ["phrase", el("input", { "data-key": "phrase", type: "text", value: option.phrase })]),
  ]);
}

function agentCard(agent) {
  if (agent.readable === false) {
    return el("div", { class: "card" }, [
      el("h3", {}, [agent.name]),
      el("p", { class: "status error" }, [agent.error || "settings.json could not be read."]),
    ]);
  }
  const status = el("p", { class: "status" });
  const tools = el("textarea", { "data-key": "tools" }, [agent.tools.join("\n")]);
  const models = agent.enabledModels === null ? null : el("textarea", { "data-key": "enabledModels" }, [agent.enabledModels.join("\n")]);
  const extensionBox = el("div", { class: "stack", "data-key": "extensions", "data-original": agent.extensions === null ? "absent" : "present" });
  for (const extension of agent.extensions || []) extensionBox.append(extensionRow(extension));
  const packageBox = agent.packages === null ? null : el("div", { class: "stack", "data-key": "packages" });
  if (packageBox) for (const item of agent.packages) packageBox.append(packageBlock(item));
  const children = [
    el("h3", {}, [agent.name]),
    el("p", { class: "meta" }, [agent.port ? `port ${agent.port} · model from ${agent.modelSource}` : "no dashboard · model from " + agent.modelSource]),
    el("div", { class: "sub" }, [
      el("h3", {}, ["Model"]),
      el("label", {}, ["provider", el("input", { "data-key": "provider", type: "text", value: agent.provider })]),
      el("label", {}, ["model", el("input", { "data-key": "model", type: "text", value: agent.model })]),
      thinkingSelect(agent.thinking),
      models ? el("label", {}, ["enabled models", models]) : el("p", { class: "meta" }, ["enabled models are not set on this agent"]),
    ]),
    el("div", { class: "sub" }, [
      el("h3", {}, ["Tools"]),
      el("label", {}, ["one name per line", tools]),
    ]),
    el("div", { class: "sub" }, [
      el("h3", {}, ["Extensions"]),
      el("p", { class: "meta" }, ["A checked path is loaded. An unchecked path stays in the list and is not loaded."]),
      extensionBox,
      el("button", { type: "button", onclick: () => extensionBox.append(extensionRow({ path: "", enabled: true })) }, ["Add extension"]),
    ]),
  ];
  if (packageBox) {
    children.push(el("div", { class: "sub" }, [el("h3", {}, ["Packages"]), packageBox]));
  }
  children.push(el("div", { class: "actions" }, [el("button", { type: "submit" }, ["Save"])]), status);
  const form = el("form", { class: "card" }, children);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const extensions = [...extensionBox.querySelectorAll(".extension")].map((row) => ({
      path: row.querySelector("[data-key='path']").value.trim(),
      enabled: row.querySelector("[data-key='enabled']").checked,
    })).filter((item) => item.path);
    void save(form, status, `/api/settings/agents/${agent.id}`, {
      provider: form.querySelector("[data-key='provider']").value,
      model: form.querySelector("[data-key='model']").value,
      thinking: form.querySelector("[data-key='thinking']").value,
      tools: lines(tools.value),
      enabledModels: models ? lines(models.value) : null,
      extensions: extensions.length === 0 && extensionBox.dataset.original === "absent" ? null : extensions,
      packages: packageBox ? readPackages(packageBox) : null,
    });
  });
  return form;
}

function thinkingSelect(current) {
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const select = el("select", { "data-key": "thinking" }, levels.map((level) => {
    const option = el("option", { value: level }, [level]);
    if (level === current) option.selected = true;
    return option;
  }));
  return el("label", {}, ["thinking", select]);
}

function extensionRow(extension) {
  return el("div", { class: "extension" }, [
    el("input", { type: "checkbox", "data-key": "enabled", ...(extension.enabled ? { checked: "checked" } : {}) }),
    el("input", { type: "text", "data-key": "path", value: extension.path }),
  ]);
}

function packageBlock(item) {
  const block = el("fieldset", { class: "fields", "data-kind": item.kind }, [
    el("label", {}, [item.kind === "name" ? "package" : "source", el("input", { "data-key": "value", type: "text", value: item.value })]),
  ]);
  if (item.kind === "source") {
    const box = el("div", { class: "stack", "data-key": "package-extensions" });
    for (const extension of item.extensions) box.append(extensionRow(extension));
    block.append(el("p", { class: "meta" }, ["package extensions"]), box);
  }
  return block;
}

function readPackages(box) {
  return [...box.querySelectorAll("fieldset")].map((block) => ({
    kind: block.dataset.kind,
    value: block.querySelector("[data-key='value']").value.trim(),
    extensions: [...block.querySelectorAll(".extension")].map((row) => ({
      path: row.querySelector("[data-key='path']").value.trim(),
      enabled: row.querySelector("[data-key='enabled']").checked,
    })).filter((item) => item.path),
  }));
}

function lines(value) {
  return value.split("\n").map((line) => line.trim()).filter((line) => line);
}

function readControl(input) {
  if (input.dataset.type === "boolean") return input.checked;
  if (input.dataset.type === "number") return Number(input.value);
  return input.value;
}

async function save(form, status, url, body) {
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  setStatus(status, "Saving.", "");
  try {
    await request(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setStatus(status, "Saved.", "ok");
  } catch (error) {
    setStatus(status, error.message, "error");
  } finally {
    button.disabled = false;
  }
}
