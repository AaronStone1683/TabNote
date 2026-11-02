globalThis.TabnoteTypeSafe = (() => {
  const API_URL = "https://api.typesafe.ai/v1/systemone";
  const MODEL = "jev-1.14.0";
  const PROMPT_VERSION = 3;
  const MIN_PROBABILITY = 0.50;
  const MIN_MARGIN = 0.05;
  const pending = new Map();

  function buildPayload(title, tasks) {
    const questions = {};
    tasks.forEach((task, index) => {
      questions[`task_${index}`] = {
        type: "noul",
        instructions: `Using only state.title, would this webpage be useful to keep with the user's task "${task.name}"? Evaluate the relationship between the title's subject and the task's goal. The title need not state the user's intended action. Consider equivalent names, abbreviations, spelling, spacing, dates, and languages. Do not invent missing context.`,
        criteria: {
          true: `The title identifies a subject, entity, resource, or step that is specifically relevant to completing the task "${task.name}".`,
          false: `The title concerns another subject, or is too broad or vague to establish a useful connection to the task "${task.name}".`
        }
      };
    });
    return { model: MODEL, state: { title }, questions };
  }

  async function requestClassification(title, tasks, apiKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      console.info("[Tabnote] TypeSafe request", { title, tasks: tasks.map((task) => task.name), model: MODEL });
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(title, tasks)),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`TypeSafe API returned HTTP ${response.status}`);
      const result = await response.json();
      const scores = tasks.map((task, index) => {
        const score = result?.answers?.[`task_${index}`]?.noul;
        if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
          throw new Error("TypeSafe API returned an invalid classification");
        }
        return { task, score };
      });
      console.info("[Tabnote] TypeSafe result", {
        title,
        scores: scores.map(({ task, score }) => ({ task: task.name, probability: score }))
      });
      return scores;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function classify(title, tasks, apiKey) {
    if (!title?.trim() || !tasks.length) return null;
    const key = JSON.stringify([MODEL, PROMPT_VERSION, title, tasks.map((task) => [task.id, task.name])]);
    if (pending.has(key)) {
      console.info("[Tabnote] TypeSafe request already pending", { title });
      return pending.get(key);
    }
    const work = (async () => {
      const known = await TabnoteDecisionStore.getMany(title, tasks, MODEL, PROMPT_VERSION);
      const missing = tasks.filter((task) => !known.has(task.id));
      if (missing.length) {
        if (!apiKey) throw new Error("Set a TypeSafe API key to classify uncached tabs.");
        const scores = await requestClassification(title, missing, apiKey);
        await TabnoteDecisionStore.putMany(title, scores, MODEL, PROMPT_VERSION);
        for (const { task, score } of scores) known.set(task.id, score);
      } else {
        console.info("[Tabnote] TypeSafe cache hit", { title, tasks: tasks.map((task) => task.name) });
      }
      const ranked = tasks.map((task) => ({ task, score: known.get(task.id) })).sort((a, b) => b.score - a.score);
      const winner = ranked[0];
      const taskId = winner.score >= MIN_PROBABILITY &&
        (!ranked[1] || winner.score - ranked[1].score >= MIN_MARGIN) ? winner.task.id : null;
      console.info("[Tabnote] Task decision", {
        title, reused: tasks.length - missing.length, evaluated: missing.length,
        selectedTask: tasks.find((task) => task.id === taskId)?.name || null
      });
      return taskId;
    })();
    pending.set(key, work);
    try {
      return await work;
    } catch (error) {
      console.error("[Tabnote] TypeSafe failed", { title, error: error.message });
      throw error;
    } finally {
      pending.delete(key);
    }
  }

  return { classify, buildPayload };
})();
