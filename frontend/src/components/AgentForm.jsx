import React, { useEffect, useState } from "react";
import { api } from "../api";

// Create or edit an agent. An agent is pure config: name, prompt, tools, model.
export default function AgentForm({ existing, onSaved, onCancel }) {
  const [tools, setTools] = useState([]);
  const [models, setModels] = useState([]);
  const [form, setForm] = useState({
    name: "",
    description: "",
    system_prompt: "You are a helpful assistant.",
    tools: [],
    model: "",
    temperature: 0.7,
    ...existing,
  });

  useEffect(() => {
    api.listTools().then(setTools);
    api.listModels().then(setModels);
  }, []);

  const toggleTool = (name) =>
    setForm((f) => ({
      ...f,
      tools: f.tools.includes(name)
        ? f.tools.filter((t) => t !== name)
        : [...f.tools, name],
    }));

  const save = async () => {
    if (!form.name.trim()) return alert("Give your agent a name.");
    const saved = existing
      ? await api.updateAgent(existing.id, form)
      : await api.createAgent(form);
    onSaved(saved);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-20">
      <div className="bg-black border border-white/30 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <h2 className="font-bold tracking-widest text-sm mb-5">
          {existing ? "EDIT CAPABILITY" : "NEW CAPABILITY"}
        </h2>

        <label className="block text-[11px] text-white/40 mb-1">NAME</label>
        <input
          className="w-full bg-black border border-white/30 px-3 py-2 mb-3 focus:border-white outline-none"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Travel Planner"
        />

        <label className="block text-[11px] text-white/40 mb-1">DESCRIPTION</label>
        <input
          className="w-full bg-black border border-white/30 px-3 py-2 mb-3 focus:border-white outline-none"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="One line on what this capability does"
        />

        <label className="block text-[11px] text-white/40 mb-1">
          SYSTEM PROMPT (PERSONALITY + INSTRUCTIONS)
        </label>
        <textarea
          className="w-full bg-black border border-white/30 px-3 py-2 mb-3 h-28 focus:border-white outline-none"
          value={form.system_prompt}
          onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
        />

        <label className="block text-[11px] text-white/40 mb-1">MODEL</label>
        <select
          className="w-full bg-black border border-white/30 px-3 py-2 mb-3 focus:border-white outline-none"
          value={form.model}
          onChange={(e) => setForm({ ...form, model: e.target.value })}
        >
          <option value="">Default</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>

        <label className="block text-[11px] text-white/40 mb-2">
          TOOLS (CAPABILITIES IT MAY USE)
        </label>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {tools.map((t) => (
            <button
              key={t.name}
              onClick={() => toggleTool(t.name)}
              className={`text-left border px-3 py-2 text-sm ${
                form.tools.includes(t.name)
                  ? "border-white bg-white/10"
                  : "border-white/20 hover:border-white/50"
              }`}
            >
              <div className="font-medium">
                {t.name}
                {t.requires_config && (
                  <span className="text-white/40 text-[10px] ml-1 border border-white/20 px-1">
                    setup
                  </span>
                )}
              </div>
              <div className="text-white/40 text-xs">{t.description}</div>
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-white/30 hover:border-white"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-4 py-2 bg-white text-black font-semibold hover:bg-white/80"
          >
            {existing ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
