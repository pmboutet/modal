import { TranscriptionManager } from '../speechmatics-transcription';

describe('TranscriptionManager speaker filtering', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test('establishes primary speaker after 2 consecutive transcripts from same speaker', async () => {
    const onMessage = jest.fn();
    const processUserMessage = jest.fn().mockResolvedValue(undefined);
    const onSpeakerEstablished = jest.fn();

    const manager = new TranscriptionManager(
      onMessage,
      processUserMessage,
      [],
      true, // enablePartials
      undefined, // no semantic options
      {
        enabled: true,
        onSpeakerEstablished,
      }
    );

    // First transcript from S1 - candidate set, not established yet
    manager.handlePartialTranscript('Bonjour', 0, 0.5, 'S1');
    expect(onSpeakerEstablished).not.toHaveBeenCalled();

    // Second transcript from S1 - should establish S1 as primary
    manager.handlePartialTranscript('comment ça va', 0.5, 1, 'S1');
    expect(onSpeakerEstablished).toHaveBeenCalledWith('S1');
    expect(onSpeakerEstablished).toHaveBeenCalledTimes(1);

    manager.cleanup();
  });

  test('resets candidate when speaker changes during establishment', async () => {
    const onMessage = jest.fn();
    const processUserMessage = jest.fn().mockResolvedValue(undefined);
    const onSpeakerEstablished = jest.fn();

    const manager = new TranscriptionManager(
      onMessage,
      processUserMessage,
      [],
      true,
      undefined,
      {
        enabled: true,
        onSpeakerEstablished,
      }
    );

    // First transcript from S1
    manager.handlePartialTranscript('Bonjour', 0, 0.5, 'S1');
    expect(onSpeakerEstablished).not.toHaveBeenCalled();

    // Second transcript from S2 - resets candidate
    manager.handlePartialTranscript('Salut', 0.5, 1, 'S2');
    expect(onSpeakerEstablished).not.toHaveBeenCalled();

    // Third transcript from S2 - should establish S2 as primary
    manager.handlePartialTranscript('ça va', 1, 1.5, 'S2');
    expect(onSpeakerEstablished).toHaveBeenCalledWith('S2');

    manager.cleanup();
  });

  test('filters out non-primary speakers after establishment', async () => {
    const onMessage = jest.fn();
    const processUserMessage = jest.fn().mockResolvedValue(undefined);
    const onSpeakerEstablished = jest.fn();

    // Mock Date.now to avoid rate limiting (100ms between calls)
    let mockTime = 1000;
    const originalDateNow = Date.now;
    Date.now = jest.fn(() => {
      mockTime += 150; // Advance by 150ms each call to bypass rate limiting
      return mockTime;
    });

    try {
      const manager = new TranscriptionManager(
        onMessage,
        processUserMessage,
        [],
        true,
        undefined,
        {
          enabled: true,
          onSpeakerEstablished,
        }
      );

      // Establish S1 as primary (2 consecutive)
      manager.handlePartialTranscript('Bonjour', 0, 0.5, 'S1');
      manager.handlePartialTranscript('je suis le speaker principal', 0.5, 1.5, 'S1');
      expect(onSpeakerEstablished).toHaveBeenCalledWith('S1');

      // Count calls after establishment
      const callsAfterEstablishment = onMessage.mock.calls.length;

      // S2 transcript should be filtered
      // Note: speaker change triggers finalization of S1's pending message first,
      // but S2's content itself should NOT appear in any message
      manager.handlePartialTranscript('Je suis la TV en fond', 2, 3, 'S2');

      // Verify S2's content was NOT included in any message
      const allContents = onMessage.mock.calls.map(call => call[0]?.content || '');
      expect(allContents.some(c => c.includes('TV'))).toBe(false);

      // S1 transcript should pass through and trigger a new message
      const callsBeforeS1Continue = onMessage.mock.calls.length;
      manager.handlePartialTranscript('je continue', 4, 5, 'S1');

      // The interim message for "je continue" should be emitted synchronously
      // Check that a new message was emitted for S1
      expect(onMessage.mock.calls.length).toBeGreaterThan(callsBeforeS1Continue);

      manager.cleanup();
    } finally {
      Date.now = originalDateNow;
    }
  });

  test('ignores UU (unknown) speakers entirely', async () => {
    const onMessage = jest.fn();
    const processUserMessage = jest.fn().mockResolvedValue(undefined);
    const onSpeakerEstablished = jest.fn();

    const manager = new TranscriptionManager(
      onMessage,
      processUserMessage,
      [],
      true,
      undefined,
      {
        enabled: true,
        onSpeakerEstablished,
      }
    );

    // UU transcript should be ignored
    manager.handlePartialTranscript('Bruit de fond', 0, 0.5, 'UU');
    expect(onSpeakerEstablished).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();

    // S1 transcript should work
    manager.handlePartialTranscript('Bonjour', 0.5, 1, 'S1');
    manager.handlePartialTranscript('ça va', 1, 1.5, 'S1');
    expect(onSpeakerEstablished).toHaveBeenCalledWith('S1');

    manager.cleanup();
  });

  test('processes all speakers when filtering is disabled', async () => {
    const onMessage = jest.fn();
    const processUserMessage = jest.fn().mockResolvedValue(undefined);

    // No filtering config = filtering disabled
    const manager = new TranscriptionManager(
      onMessage,
      processUserMessage,
      [],
      true,
      undefined,
      undefined // No filtering config
    );

    // All speakers should be processed and trigger messages
    // Note: speaker change detection causes previous speaker's message to be finalized
    manager.handlePartialTranscript('Speaker one talking', 0, 0.5, 'S1');
    expect(onMessage).toHaveBeenCalled();
    const callsAfterS1 = onMessage.mock.calls.length;

    manager.handlePartialTranscript('Speaker two talking', 1, 1.5, 'S2');
    // Speaker change should have triggered processing + new interim
    expect(onMessage.mock.calls.length).toBeGreaterThan(callsAfterS1);
    const callsAfterS2 = onMessage.mock.calls.length;

    manager.handlePartialTranscript('Speaker three talking', 2, 2.5, 'S3');
    // Another speaker change + new interim
    expect(onMessage.mock.calls.length).toBeGreaterThan(callsAfterS2);

    // Key assertion: without filtering, all speakers trigger messages
    // (filtering would have blocked S2 and S3 after S1 was established)
    expect(onMessage.mock.calls.length).toBeGreaterThanOrEqual(3);

    manager.cleanup();
  });

  test('handleFinalTranscript also filters non-primary speakers', async () => {
    const onMessage = jest.fn();
    const processUserMessage = jest.fn().mockResolvedValue(undefined);
    const onSpeakerEstablished = jest.fn();

    const manager = new TranscriptionManager(
      onMessage,
      processUserMessage,
      [],
      true,
      undefined,
      {
        enabled: true,
        onSpeakerEstablished,
      }
    );

    // Establish S1 as primary using final transcripts
    manager.handleFinalTranscript('Bonjour', 0, 0.5, 'S1');
    manager.handleFinalTranscript('je suis le speaker principal', 0.5, 1.5, 'S1');
    expect(onSpeakerEstablished).toHaveBeenCalledWith('S1');

    // S2 final transcript should be filtered
    manager.handleFinalTranscript('Je suis la TV en fond', 2, 3, 'S2');

    // Should not trigger finalization for S2
    expect(manager.hasPendingTranscript()).toBe(true); // S1's transcript is pending

    manager.cleanup();
  });

  test('resetSpeakerFiltering clears primary speaker', async () => {
    const onMessage = jest.fn();
    const processUserMessage = jest.fn().mockResolvedValue(undefined);
    const onSpeakerEstablished = jest.fn();

    const manager = new TranscriptionManager(
      onMessage,
      processUserMessage,
      [],
      true,
      undefined,
      {
        enabled: true,
        onSpeakerEstablished,
      }
    );

    // Establish S1 as primary
    manager.handlePartialTranscript('Bonjour', 0, 0.5, 'S1');
    manager.handlePartialTranscript('ça va', 0.5, 1, 'S1');
    expect(onSpeakerEstablished).toHaveBeenCalledWith('S1');
    expect(manager.getPrimarySpeaker()).toBe('S1');

    // Reset speaker filtering
    manager.resetSpeakerFiltering();
    expect(manager.getPrimarySpeaker()).toBeUndefined();

    // Should be able to establish a new primary speaker
    onSpeakerEstablished.mockClear();
    manager.handlePartialTranscript('Hello', 2, 2.5, 'S2');
    manager.handlePartialTranscript('world', 2.5, 3, 'S2');
    expect(onSpeakerEstablished).toHaveBeenCalledWith('S2');
    expect(manager.getPrimarySpeaker()).toBe('S2');

    manager.cleanup();
  });

  describe('filtered speaker safety net', () => {
    test('triggers safety net when filtered speaker partial arrives after silence timeout', async () => {
      const onMessage = jest.fn();
      const processUserMessage = jest.fn().mockResolvedValue(undefined);
      const onSpeakerEstablished = jest.fn();
      const onSpeakerFiltered = jest.fn();

      // Mock Date.now to control time
      let mockTime = 1000;
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => mockTime);

      try {
        const manager = new TranscriptionManager(
          onMessage,
          processUserMessage,
          [],
          true,
          undefined,
          {
            enabled: true,
            onSpeakerEstablished,
            onSpeakerFiltered,
          }
        );

        // Establish S1 as primary
        manager.handlePartialTranscript('Bonjour', 0, 0.5, 'S1');
        mockTime += 150;
        manager.handlePartialTranscript('comment ça va', 0.5, 1.5, 'S1');
        expect(onSpeakerEstablished).toHaveBeenCalledWith('S1');

        // Add pending content from S1
        mockTime += 150;
        manager.handlePartialTranscript('Une question importante pour toi', 1.5, 3, 'S1');

        // Advance time past SILENCE_DETECTION_TIMEOUT (2000ms)
        mockTime += 2500;

        // Filtered speaker arrives - should trigger safety net
        manager.handlePartialTranscript('Bruit de TV', 3, 4, 'S2');

        // Should have been filtered
        expect(onSpeakerFiltered).toHaveBeenCalledWith('S2', 'Bruit de TV');

        // Safety net should have triggered processPendingTranscript
        // Run any pending promises
        await Promise.resolve();

        // processUserMessage should have been called due to safety net
        expect(processUserMessage).toHaveBeenCalled();

        manager.cleanup();
      } finally {
        Date.now = originalDateNow;
      }
    });

    test('does NOT trigger safety net when filtered speaker arrives before timeout', async () => {
      const onMessage = jest.fn();
      const processUserMessage = jest.fn().mockResolvedValue(undefined);
      const onSpeakerEstablished = jest.fn();
      const onSpeakerFiltered = jest.fn();

      // Mock Date.now to control time
      let mockTime = 1000;
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => mockTime);

      try {
        const manager = new TranscriptionManager(
          onMessage,
          processUserMessage,
          [],
          true,
          undefined,
          {
            enabled: true,
            onSpeakerEstablished,
            onSpeakerFiltered,
          }
        );

        // Establish S1 as primary
        manager.handlePartialTranscript('Bonjour', 0, 0.5, 'S1');
        mockTime += 150;
        manager.handlePartialTranscript('comment ça va', 0.5, 1.5, 'S1');
        expect(onSpeakerEstablished).toHaveBeenCalledWith('S1');

        // Add short pending content from S1 (too short to be complete)
        mockTime += 150;
        manager.handlePartialTranscript('Hi', 1.5, 1.8, 'S1');

        // First filtered speaker partial - triggers speaker change (S1→S2)
        // but pending is too short to process, so it remains pending
        mockTime += 150;
        manager.handlePartialTranscript('Bruit de TV', 2, 2.5, 'S2');
        expect(onSpeakerFiltered).toHaveBeenCalledWith('S2', 'Bruit de TV');

        // Clear mock to check only subsequent calls
        processUserMessage.mockClear();
        onSpeakerFiltered.mockClear();

        // Only advance 500ms (less than SILENCE_DETECTION_TIMEOUT of 2000ms)
        mockTime += 500;

        // Second filtered speaker partial - same speaker, no speaker change
        // Safety net should NOT trigger (not enough time elapsed)
        manager.handlePartialTranscript('Plus de bruit', 2.5, 3, 'S2');

        // Should have been filtered
        expect(onSpeakerFiltered).toHaveBeenCalledWith('S2', 'Plus de bruit');

        // But processUserMessage should NOT have been called (safety net not triggered - too soon)
        expect(processUserMessage).not.toHaveBeenCalled();

        manager.cleanup();
      } finally {
        Date.now = originalDateNow;
      }
    });

    test('does NOT trigger safety net when no pending content', async () => {
      const onMessage = jest.fn();
      const processUserMessage = jest.fn().mockResolvedValue(undefined);
      const onSpeakerEstablished = jest.fn();
      const onSpeakerFiltered = jest.fn();

      // Mock Date.now to control time
      let mockTime = 1000;
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => mockTime);

      try {
        const manager = new TranscriptionManager(
          onMessage,
          processUserMessage,
          [],
          true,
          undefined,
          {
            enabled: true,
            onSpeakerEstablished,
            onSpeakerFiltered,
          }
        );

        // Establish S1 as primary
        manager.handlePartialTranscript('Bonjour', 0, 0.5, 'S1');
        mockTime += 150;
        manager.handlePartialTranscript('comment ça va', 0.5, 1.5, 'S1');
        expect(onSpeakerEstablished).toHaveBeenCalledWith('S1');

        // Process pending content to clear it
        mockTime += 150;
        await manager.processPendingTranscript(true, true);
        processUserMessage.mockClear();

        // Advance time past timeout
        mockTime += 2500;

        // Filtered speaker arrives with no pending content
        manager.handlePartialTranscript('Bruit de TV', 2, 3, 'S2');

        // Should have been filtered
        expect(onSpeakerFiltered).toHaveBeenCalledWith('S2', 'Bruit de TV');

        // But processUserMessage should NOT have been called (no pending content)
        expect(processUserMessage).not.toHaveBeenCalled();

        manager.cleanup();
      } finally {
        Date.now = originalDateNow;
      }
    });

    test('safety net also works with handleFinalTranscript', async () => {
      const onMessage = jest.fn();
      const processUserMessage = jest.fn().mockResolvedValue(undefined);
      const onSpeakerEstablished = jest.fn();
      const onSpeakerFiltered = jest.fn();

      // Mock Date.now to control time
      let mockTime = 1000;
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => mockTime);

      try {
        const manager = new TranscriptionManager(
          onMessage,
          processUserMessage,
          [],
          true,
          undefined,
          {
            enabled: true,
            onSpeakerEstablished,
            onSpeakerFiltered,
          }
        );

        // Establish S1 as primary
        manager.handleFinalTranscript('Bonjour', 0, 0.5, 'S1');
        mockTime += 150;
        manager.handleFinalTranscript('comment ça va', 0.5, 1.5, 'S1');
        expect(onSpeakerEstablished).toHaveBeenCalledWith('S1');

        // Add pending content from S1
        mockTime += 150;
        manager.handleFinalTranscript('Une question importante pour toi', 1.5, 3, 'S1');

        // Advance time past timeout
        mockTime += 2500;

        // Filtered speaker final transcript arrives - should trigger safety net
        manager.handleFinalTranscript('Bruit de TV', 3, 4, 'S2');

        // Should have been filtered
        expect(onSpeakerFiltered).toHaveBeenCalledWith('S2', 'Bruit de TV');

        // Run any pending promises
        await Promise.resolve();

        // processUserMessage should have been called due to safety net
        expect(processUserMessage).toHaveBeenCalled();

        manager.cleanup();
      } finally {
        Date.now = originalDateNow;
      }
    });
  });
});
