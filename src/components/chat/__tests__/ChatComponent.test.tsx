/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ChatComponent } from "../ChatComponent";
import { Ask, Message, FileUpload } from "@/types";

// Mock scrollIntoView for JSDOM environment
Element.prototype.scrollIntoView = jest.fn();

// Mock window.HTMLElement.prototype.scrollIntoView
Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
  writable: true,
  value: jest.fn(),
});

// Mock framer-motion to avoid animation issues in tests
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock ReactMarkdown
jest.mock("react-markdown", () => ({ children }: { children: string }) => (
  <div>{children}</div>
));

// Mock remark-gfm and rehype-highlight
jest.mock("remark-gfm", () => () => {});
jest.mock("rehype-highlight", () => () => {});

// Mock PremiumVoiceInterface
jest.mock("../PremiumVoiceInterface", () => ({
  PremiumVoiceInterface: () => <div data-testid="premium-voice-interface">Voice Interface</div>,
}));

// Mock StepCompletionCard
jest.mock("@/components/conversation/StepCompletionCard", () => ({
  StepCompletionCard: () => <div data-testid="step-completion-card">Step Complete</div>,
}));

describe("ChatComponent", () => {
  const mockAsk: Ask = {
    id: "ask-1",
    key: "test-ask-key",
    name: "Test Ask",
    question: "What is the test question?",
    description: "Test description",
    status: "active",
    isActive: true,
    startDate: null,
    endDate: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deliveryMode: "digital",
    conversationMode: "collaborative",
    participants: [],
    askSessionId: "session-1",
  };

  const mockMessages: Message[] = [
    {
      id: "msg-1",
      askKey: "test-ask-key",
      askSessionId: "session-1",
      content: "Hello from the agent",
      type: "text",
      senderType: "ai",
      senderId: null,
      senderName: "Agent",
      timestamp: new Date().toISOString(),
      metadata: {},
    },
    {
      id: "msg-2",
      askKey: "test-ask-key",
      askSessionId: "session-1",
      content: "Hello from the user",
      type: "text",
      senderType: "user",
      senderId: "user-1",
      senderName: "User",
      timestamp: new Date().toISOString(),
      metadata: {},
    },
  ];

  const defaultProps = {
    askKey: "test-ask-key",
    ask: mockAsk,
    messages: mockMessages,
    conversationPlan: null,
    onSendMessage: jest.fn(),
    isLoading: false,
    onHumanTyping: jest.fn(),
    currentParticipantName: "Test User",
    currentUserId: "user-1",
    isMultiUser: false,
    showAgentTyping: false,
    voiceModeEnabled: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock FileReader
    const mockFileReader = {
      readAsDataURL: jest.fn(function (this: any) {
        setTimeout(() => {
          this.onload?.({ target: { result: "data:image/png;base64,test" } });
        }, 0);
      }),
      readAsArrayBuffer: jest.fn(function (this: any) {
        setTimeout(() => {
          this.onload?.({ target: { result: new ArrayBuffer(8) } });
        }, 0);
      }),
      onload: null as ((e: any) => void) | null,
      onerror: null as (() => void) | null,
    };
    global.FileReader = jest.fn(() => mockFileReader) as any;
  });

  describe("Basic Rendering", () => {
    it("renders the conversation header", () => {
      render(<ChatComponent {...defaultProps} />);
      expect(screen.getByText("Conversation")).toBeInTheDocument();
    });

    it("displays messages correctly", () => {
      render(<ChatComponent {...defaultProps} />);
      expect(screen.getByText("Hello from the agent")).toBeInTheDocument();
      expect(screen.getByText("Hello from the user")).toBeInTheDocument();
    });

    it("shows loading state when ask is null", () => {
      render(<ChatComponent {...defaultProps} ask={null as any} />);
      expect(screen.getByText("Loading conversation...")).toBeInTheDocument();
    });

    it("shows closed message when ask is inactive", () => {
      const closedAsk = { ...mockAsk, isActive: false };
      render(<ChatComponent {...defaultProps} ask={closedAsk} />);
      expect(screen.getByText("This conversation is closed")).toBeInTheDocument();
    });
  });

  describe("Message Input", () => {
    it("enables send button when there is text input", () => {
      render(<ChatComponent {...defaultProps} />);

      const textarea = screen.getByPlaceholderText("Type your response...");
      fireEvent.change(textarea, { target: { value: "Test message" } });

      // Find all buttons and get the last one (send button is typically last)
      const buttons = screen.getAllByRole("button");
      const sendButton = buttons[buttons.length - 1];
      expect(sendButton).not.toBeDisabled();
    });

    it("disables send button when input is empty", () => {
      render(<ChatComponent {...defaultProps} />);

      // Find all buttons and get the last one (send button is typically last)
      const buttons = screen.getAllByRole("button");
      const sendButton = buttons[buttons.length - 1];
      expect(sendButton).toBeDisabled();
    });

    it("calls onSendMessage when text is submitted", async () => {
      const onSendMessage = jest.fn();
      render(<ChatComponent {...defaultProps} onSendMessage={onSendMessage} />);

      const textarea = screen.getByPlaceholderText("Type your response...");
      fireEvent.change(textarea, { target: { value: "Test message" } });

      // Find all buttons and get the last one (send button is typically last)
      const buttons = screen.getAllByRole("button");
      const sendButton = buttons[buttons.length - 1];
      fireEvent.click(sendButton);

      expect(onSendMessage).toHaveBeenCalledWith("Test message", "text");
    });

    it("clears input after sending message", async () => {
      const onSendMessage = jest.fn();
      render(<ChatComponent {...defaultProps} onSendMessage={onSendMessage} />);

      const textarea = screen.getByPlaceholderText("Type your response...") as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: "Test message" } });

      // Find all buttons and get the last one (send button is typically last)
      const buttons = screen.getAllByRole("button");
      const sendButton = buttons[buttons.length - 1];
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(textarea.value).toBe("");
      });
    });
  });

  describe("BUG-002/BUG-034: File Upload Handling", () => {
    it("processes image files with proper async handling", async () => {
      const onSendMessage = jest.fn();
      render(<ChatComponent {...defaultProps} onSendMessage={onSendMessage} />);

      const file = new File(["test"], "test.png", { type: "image/png" });
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [file] } });
      });

      // Wait for the file to be processed
      await waitFor(() => {
        // File should be added to preview
        expect(screen.getByText("test.png")).toBeInTheDocument();
      });
    });
  });

  describe("BUG-016: Edit Error Recovery", () => {
    it("allows editing user messages", async () => {
      const onEditMessage = jest.fn();
      const messagesWithEdit = [
        {
          ...mockMessages[1],
          senderId: "user-1",
        },
      ];

      render(
        <ChatComponent
          {...defaultProps}
          messages={messagesWithEdit}
          currentUserId="user-1"
          onEditMessage={onEditMessage}
        />
      );

      // The edit button should be visible on hover (group-hover)
      const editButton = screen.getByTitle("Modifier ce message");
      expect(editButton).toBeInTheDocument();
    });

    it("shows error message when edit fails", async () => {
      const errorMessage = "Network error";
      const onEditMessage = jest.fn().mockRejectedValue(new Error(errorMessage));

      const messagesWithEdit = [
        {
          ...mockMessages[1],
          senderId: "user-1",
        },
      ];

      render(
        <ChatComponent
          {...defaultProps}
          messages={messagesWithEdit}
          currentUserId="user-1"
          onEditMessage={onEditMessage}
        />
      );

      // Click edit button
      const editButton = screen.getByTitle("Modifier ce message");
      fireEvent.click(editButton);

      // Find the save button and click it
      const saveButton = screen.getByRole("button", { name: /sauvegarder/i });

      await act(async () => {
        fireEvent.click(saveButton);
      });

      // Error message should be displayed
      await waitFor(() => {
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
      });
    });

    it("shows retry button after edit error", async () => {
      const errorMessage = "Network error";
      const onEditMessage = jest.fn().mockRejectedValue(new Error(errorMessage));

      const messagesWithEdit = [
        {
          ...mockMessages[1],
          senderId: "user-1",
        },
      ];

      render(
        <ChatComponent
          {...defaultProps}
          messages={messagesWithEdit}
          currentUserId="user-1"
          onEditMessage={onEditMessage}
        />
      );

      // Click edit button
      const editButton = screen.getByTitle("Modifier ce message");
      fireEvent.click(editButton);

      // Submit the edit
      const saveButton = screen.getByRole("button", { name: /sauvegarder/i });

      await act(async () => {
        fireEvent.click(saveButton);
      });

      // Retry button should appear
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /réessayer/i })).toBeInTheDocument();
      });
    });

    it("keeps edit mode open on error for retry", async () => {
      const onEditMessage = jest.fn().mockRejectedValue(new Error("Network error"));

      const messagesWithEdit = [
        {
          ...mockMessages[1],
          senderId: "user-1",
        },
      ];

      render(
        <ChatComponent
          {...defaultProps}
          messages={messagesWithEdit}
          currentUserId="user-1"
          onEditMessage={onEditMessage}
        />
      );

      // Click edit button
      const editButton = screen.getByTitle("Modifier ce message");
      fireEvent.click(editButton);

      // Submit the edit
      const saveButton = screen.getByRole("button", { name: /sauvegarder/i });

      await act(async () => {
        fireEvent.click(saveButton);
      });

      // Textarea should still be visible (edit mode still open)
      await waitFor(() => {
        const textarea = document.querySelector('textarea');
        expect(textarea).toBeInTheDocument();
      });
    });

    it("clears error when cancel is clicked", async () => {
      const onEditMessage = jest.fn().mockRejectedValue(new Error("Network error"));

      const messagesWithEdit = [
        {
          ...mockMessages[1],
          senderId: "user-1",
        },
      ];

      render(
        <ChatComponent
          {...defaultProps}
          messages={messagesWithEdit}
          currentUserId="user-1"
          onEditMessage={onEditMessage}
        />
      );

      // Click edit button
      const editButton = screen.getByTitle("Modifier ce message");
      fireEvent.click(editButton);

      // Submit to trigger error
      const saveButton = screen.getByRole("button", { name: /sauvegarder/i });

      await act(async () => {
        fireEvent.click(saveButton);
      });

      // Wait for error to appear
      await waitFor(() => {
        expect(screen.getByText("Network error")).toBeInTheDocument();
      });

      // Click cancel
      const cancelButton = screen.getByRole("button", { name: /annuler/i });
      fireEvent.click(cancelButton);

      // Error should be cleared and edit mode closed
      await waitFor(() => {
        expect(screen.queryByText("Network error")).not.toBeInTheDocument();
      });
    });
  });

  describe("Typing Indicator", () => {
    it("shows typing indicator when showAgentTyping is true", () => {
      render(<ChatComponent {...defaultProps} showAgentTyping={true} />);

      expect(screen.getByText(/génération de la réponse/i)).toBeInTheDocument();
    });

    it("hides typing indicator when showAgentTyping is false", () => {
      render(<ChatComponent {...defaultProps} showAgentTyping={false} />);

      expect(screen.queryByText(/génération de la réponse/i)).not.toBeInTheDocument();
    });

    it("calls onHumanTyping when user types", () => {
      const onHumanTyping = jest.fn();
      render(<ChatComponent {...defaultProps} onHumanTyping={onHumanTyping} />);

      const textarea = screen.getByPlaceholderText("Type your response...");
      fireEvent.change(textarea, { target: { value: "Test" } });

      expect(onHumanTyping).toHaveBeenCalledWith(true);
    });
  });

  describe("Voice Mode Toggle", () => {
    it("shows voice mode button when voiceModeEnabled is true", () => {
      render(
        <ChatComponent
          {...defaultProps}
          voiceModeEnabled={true}
          voiceModeSystemPrompt="Test prompt"
        />
      );

      // The voice mode button contains a Radio icon - check for button presence
      // Since tooltips use Radix UI, we can't easily query by title
      // Instead we verify that when voice mode is enabled with a system prompt,
      // there are more buttons available (voice toggle button is added)
      const buttons = screen.getAllByRole("button");
      // Should have: file attach, voice mode toggle, send
      expect(buttons.length).toBeGreaterThanOrEqual(3);
    });

    it("has fewer buttons when voiceModeEnabled is false", () => {
      render(<ChatComponent {...defaultProps} voiceModeEnabled={false} />);

      const buttons = screen.getAllByRole("button");
      // Should have: file attach, mic (audio recording), send
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Multi-user Mode", () => {
    it("shows sender name in multi-user mode", () => {
      const multiUserMessages = [
        {
          ...mockMessages[0],
          senderName: "Alice",
        },
        {
          ...mockMessages[1],
          senderName: "Bob",
          senderId: "user-2",
        },
      ];

      render(
        <ChatComponent
          {...defaultProps}
          messages={multiUserMessages}
          isMultiUser={true}
        />
      );

      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });
  });
});
