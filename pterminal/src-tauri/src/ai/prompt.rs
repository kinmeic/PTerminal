use crate::ai::{AiConfig, ChatMessage};

/// Rough token estimation: ~4 chars/token for English, ~2 for CJK.
/// This is a fast heuristic; actual tokenization varies by model.
fn estimate_tokens(text: &str) -> usize {
    let mut count = 0;
    for ch in text.chars() {
        if ch.is_ascii() {
            count += 1;
        } else {
            // CJK and other multi-byte chars count as ~2 tokens each
            count += 2;
        }
    }
    count / 4
}

/// Estimate total tokens across all messages.
fn estimate_messages_tokens(messages: &[ChatMessage]) -> usize {
    messages.iter().map(|m| estimate_tokens(&m.content) + 4).sum() // +4 for role/formatting
}

/// Compress conversation history when it exceeds the context budget.
/// Strategy: keep system message + most recent messages that fit within budget.
fn compress_history(messages: Vec<ChatMessage>, budget: usize) -> Vec<ChatMessage> {
    if messages.is_empty() {
        return messages;
    }

    let total = estimate_messages_tokens(&messages);
    if total <= budget {
        return messages;
    }

    // Always keep the system message (first) and current user message (last).
    // Trim from the middle (older conversation turns).
    let mut result = Vec::new();

    // Keep system message if present
    let start_idx = if messages.first().map(|m| m.role.as_str()) == Some("system") {
        result.push(messages[0].clone());
        1
    } else {
        0
    };

    // Keep the last user message
    let end_idx = messages.len();
    let last_user_idx = messages.iter().rposition(|m| m.role == "user");

    // Calculate remaining budget after system + last user message
    let system_tokens = result.iter().map(|m| estimate_tokens(&m.content) + 4).sum::<usize>();
    let last_user_tokens = last_user_idx.map(|i| estimate_tokens(&messages[i].content) + 4).unwrap_or(0);
    let remaining_budget = budget.saturating_sub(system_tokens + last_user_tokens);

    // Add messages from the end (most recent) until budget is exhausted
    let mut middle_messages: Vec<&ChatMessage> = messages[start_idx..end_idx]
        .iter()
        .enumerate()
        .filter(|(idx, _)| last_user_idx.map(|i| start_idx + idx != i).unwrap_or(true))
        .map(|(_, m)| m)
        .collect();
    middle_messages.reverse(); // Process from most recent

    let mut added: Vec<ChatMessage> = Vec::new();
    let mut used = 0;
    for msg in middle_messages {
        let tokens = estimate_tokens(&msg.content) + 4;
        if used + tokens > remaining_budget {
            break;
        }
        used += tokens;
        added.push(msg.clone());
    }
    added.reverse(); // Restore chronological order
    result.extend(added);

    // Add last user message
    if let Some(idx) = last_user_idx {
        result.push(messages[idx].clone());
    }

    log::info!(
        "Context compressed: {} messages ({} tokens) -> {} messages (~{} tokens)",
        messages.len(),
        total,
        result.len(),
        estimate_messages_tokens(&result)
    );

    result
}

/// Build the system + user message pair for a general assistant chat turn.
/// `terminal_context` is an optional snapshot of recent terminal output that
/// gives the assistant visibility into what the user is seeing (errors, logs).
pub fn chat_messages(
    history: &[ChatMessage],
    user_text: &str,
    cwd: &str,
    terminal_context: Option<&str>,
    config: &AiConfig,
) -> Vec<ChatMessage> {
    let context_block = match terminal_context {
        Some(c) if !c.trim().is_empty() => format!(
            "\n\nThe user's most recent terminal output is shown below. Use it to \
             understand what they're working on, but do not assume they are asking \
             about it unless their message references it.\n\n```\n{c}\n```"
        ),
        _ => String::new(),
    };
    let mut msgs = vec![ChatMessage {
        role: "system".to_string(),
        content: format!(
            "You are PTerminal, a helpful assistant embedded in a macOS terminal app. \
             The user is working in the directory: {cwd}.{context_block} \
             Answer concisely. When suggesting shell commands, wrap them in a single \
             fenced code block labelled ```sh so they can be extracted. Respond in the \
             same language the user writes in."
        ),
    }];
    msgs.extend_from_slice(history);
    msgs.push(ChatMessage {
        role: "user".to_string(),
        content: user_text.to_string(),
    });

    // Apply compression if needed
    let budget = (config.context_window as f32 * config.compression_threshold) as usize;
    compress_history(msgs, budget)
}

/// Natural-language → shell command. Output must be a raw command (no prose).
pub fn suggest_messages(prompt: &str, cwd: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: format!(
                "You convert natural-language requests into a single macOS/zsh shell command. \
                 Working directory: {cwd}. \
                 Reply with ONLY the command — no explanation, no markdown fences, no backticks. \
                 If the request is ambiguous, pick the most reasonable interpretation."
            ),
        },
        ChatMessage {
            role: "user".to_string(),
            content: prompt.to_string(),
        },
    ]
}

/// Explain terminal output in plain language.
pub fn explain_messages(output: &str, cwd: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: format!(
                "You explain terminal output clearly in the user's language. \
                 Working directory: {cwd}. Keep explanations short and structured. \
                 If the output indicates an error, explain the cause and suggest a fix."
            ),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!("Explain this terminal output:\n\n```\n{output}\n```"),
        },
    ]
}

/// Diagnose a failed command's output and propose a fix.
pub fn diagnose_messages(output: &str, cwd: &str) -> Vec<ChatMessage> {
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: format!(
                "You diagnose shell command errors. Working directory: {cwd}. \
                 Identify the root cause, then give the corrected command in a ```sh block. \
                 Be concise."
            ),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!("This command failed:\n\n```\n{output}\n```\n\nWhat went wrong and how do I fix it?"),
        },
    ]
}

/// Shell command autocomplete. Given a partial command and context, return
/// multiple likely FULL completions as a JSON array of strings.
///
/// Each item is the FULL completed command (e.g. "git status"), not just the
/// suffix. The frontend displays the full text and computes the suffix to write
/// when the user accepts (full minus what they already typed). This makes the
/// popup readable ("status" instead of "tatus") and lets the frontend filter
/// locally as the user keeps typing — avoiding redundant AI requests.
pub fn autocomplete_messages(
    partial_cmd: &str,
    cwd: &str,
    terminal_context: Option<&str>,
) -> Vec<ChatMessage> {
    let context_block = match terminal_context {
        Some(c) if !c.trim().is_empty() => format!(
            "\n\nRecent terminal output for context:\n\n```\n{c}\n```"
        ),
        _ => String::new(),
    };
    vec![
        ChatMessage {
            role: "system".to_string(),
            content: format!(
                "You are a shell command autocomplete assistant. \
                 The user is working in directory: {cwd}. \
                 The user has typed a partial command. Suggest up to 5 likely FULL completions. \
                 \
                 Each suggestion must be the FULL completed command including what the user \
                 already typed. For example, if the user typed \"git s\", suggestions could be \
                 [\"git status\", \"git stash\", \"git show\"]. \
                 \
                 Output a JSON array of full command strings, ordered by likelihood. \
                 If the partial command is already complete or unrecognizable, output []. \
                 No explanation, no markdown fences, just the JSON array.{context_block}"
            ),
        },
        ChatMessage {
            role: "user".to_string(),
            content: format!("Partial command: {partial_cmd}"),
        },
    ]
}
