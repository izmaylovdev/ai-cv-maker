import { useEffect } from 'react';
import { ChatMessage, ChatMessages, ChatSection } from '@llamaindex/chat-ui';
import { Composer } from './components/Composer';
import { ErrorPart, FillAction, MarkdownLink, UserTextPart } from './components/MessageParts';
import { useApplysyChat } from './useApplysyChat';
import './ChatApp.css';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  /**
   * US-EXT-4 — when set, this assistant message carries a fillable draft (e.g. a
   * cover letter). A "Use this" action is rendered beneath it; nothing is filled
   * until the user accepts.
   */
  fillText?: string;
}

// US-AI-9 §6.3 — an edit the assistant proposes against the open document.
export interface ChatEdit {
  patchJson: string;
  description: string;
}

// US-EXT-4 — the current page's job posting, sent as context by the side-panel
// (extension) chat. Mutually exclusive with `document` (edit mode).
export interface JobContext {
  jobTitle: string;
  jobDescription: string;
  fieldContext: string;
}

// US-EXT-4 — a fillable draft the user accepted via "Use this".
export interface ChatFill {
  text: string;
}

interface Props {
  authToken: string;
  apiBase: string;
  /**
   * The open profile document (in-editor chat only). When provided it is sent
   * as context with every message, enabling edit mode. Omitted on the global
   * read-only assistant.
   */
  document?: unknown;
  /**
   * The id of the open profile (in-editor chat only). Sent alongside `document`
   * so the agent's cross-profile reads exclude the profile being edited (US-AI-13)
   * — otherwise the open profile lists itself as a source to populate from.
   */
  profileId?: string;
  /**
   * The current page's job posting (side-panel chat only). When provided it is
   * sent as context with every message; the assistant can answer questions about
   * the role and propose a cover letter. Mutually exclusive with `document`.
   */
  jobContext?: JobContext;
  /** Called when the assistant returns an edit to apply to {@link document}. */
  onEdit?: (edit: ChatEdit) => void;
  /** Called when the user accepts a fillable draft via "Use this" (US-EXT-4). */
  onFill?: (fill: ChatFill) => void;
  /** Exposes an imperative API to the host (e.g. to append a note to the thread). */
  onReady?: (api: ChatApi) => void;
}

export interface ChatApi {
  /** Append an assistant-authored note to the thread (e.g. a rejected edit). */
  addAssistantNote: (text: string) => void;
}

// Raw HTML stays inert: Chat UI's Markdown has no rehype-raw (F-CHAT-5.6).
const markdownComponents = { a: MarkdownLink };

/**
 * The widget, composed from LlamaIndex Chat UI: a message thread and a composer
 * driven by {@link useApplysyChat}.
 */
export function ChatApp({ authToken, apiBase, document, profileId, jobContext, onEdit, onFill, onReady }: Props) {
  const { handler, addAssistantNote, isEmpty } = useApplysyChat({
    authToken,
    apiBase,
    document,
    profileId,
    jobContext,
    onEdit,
  });

  useEffect(() => {
    onReady?.({ addAssistantNote });
  }, [onReady, addAssistantNote]);

  const fill = onFill ? (text: string) => onFill({ text }) : undefined;

  // US-AI-12 — the in-editor chat (bound to the open `document`) opens directly
  // in the conversation layout, so the greeting and the first message share the
  // same input position. The global read-only assistant keeps the centered
  // landing splash for its empty state.
  const showLanding = isEmpty && !document;

  return (
    <ChatSection handler={handler} className="chat-app bg-background text-foreground gap-0 p-0">
      {showLanding ? (
        <div className="flex h-full flex-col items-center justify-center px-6">
          <div className="mb-[10%] flex w-full max-w-[680px] flex-col items-center gap-5">
            <div className="text-center text-[26px] font-semibold tracking-tight">How can I help you?</div>
            <Composer className="chat-landing-composer w-full bg-transparent p-0" />
          </div>
        </div>
      ) : (
        <>
          <ChatMessages className="space-y-0 bg-transparent p-0">
            <ChatMessages.List className="gap-4 px-4 pt-4 pb-2">
              {handler.messages.map((message, index) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isLast={index === handler.messages.length - 1}
                  className="gap-3 p-0"
                >
                  <ChatMessage.Avatar className="size-7" />
                  <ChatMessage.Content className="gap-2">
                    {message.role === 'user' ? (
                      <UserTextPart />
                    ) : (
                      <ChatMessage.Part.Markdown className="chat-markdown" components={markdownComponents} />
                    )}
                    <ErrorPart />
                    {/* Directly under the draft it fills, not in the far-right actions slot. */}
                    <FillAction onFill={fill} />
                  </ChatMessage.Content>
                </ChatMessage>
              ))}
              <ChatMessages.Empty className="text-muted-foreground items-center justify-start pt-8 text-center italic">
                Ask me to edit your CV — add a role, rewrite a summary, or turn a list into chips.
              </ChatMessages.Empty>
              <ChatMessages.Loading className="text-muted-foreground justify-start pt-0 pl-10" />
            </ChatMessages.List>
          </ChatMessages>
          <Composer className="px-4 pt-2 pb-4" />
        </>
      )}
    </ChatSection>
  );
}
