import { NextRequest } from 'next/server';
import { callModelProviderStream } from '@/lib/ai/providers';
import { DEFAULT_MAX_OUTPUT_TOKENS } from '@/lib/ai/constants';
import { getAdminSupabaseClient } from '@/lib/supabaseAdmin';

// Extend timeout for streaming LLM responses
export const maxDuration = 60;
import { getAskSessionByKey } from '@/lib/asks';
import { getAgentConfigForAsk } from '@/lib/ai/agent-config';
import { buildConversationAgentVariables } from '@/lib/ai/conversation-agent';
import { fetchElapsedTime } from '@/lib/conversation-context';
import type { AiModelConfig } from '@/types';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const body = await request.json();
    const userMessage = body.message || 'Bonjour !';

    console.log('Simple streaming test for key:', key);
    console.log('User message:', userMessage);

    // Récupérer la session ASK pour obtenir la configuration de l'agent
    const supabase = getAdminSupabaseClient();
    const { row: askRow, error: askError } = await getAskSessionByKey<{ 
      id: string; 
      ask_key: string; 
      question: string; 
      description?: string | null;
      project_id?: string | null;
      challenge_id?: string | null;
    }>(
      supabase,
      key,
      'id, ask_key, question, description, project_id, challenge_id'
    );

    if (askError) {
      console.error('Error fetching ask session:', askError);
      return new Response(
        JSON.stringify({ error: 'Session not found' }), 
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (!askRow) {
      return new Response(
        JSON.stringify({ error: 'Session not found' }), 
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Fetch elapsed times using centralized helper (DRY - same as stream route)
    // Note: For stream-simple, there's no conversation context, so times will be 0
    const { elapsedActiveSeconds, stepElapsedActiveSeconds } = await fetchElapsedTime({
      supabase,
      askSessionId: askRow.id,
      profileId: null,
      conversationPlan: null,
    });

    // Use centralized function for prompt variables
    const promptVariables = buildConversationAgentVariables({
      ask: {
        ask_key: askRow.ask_key,
        question: askRow.question,
        description: askRow.description,
        system_prompt: null,
      },
      project: null,
      challenge: null,
      messages: [],
      participants: [],
      conversationPlan: null,
      elapsedActiveSeconds,
      stepElapsedActiveSeconds,
    });

    const agentConfig = await getAgentConfigForAsk(
      supabase,
      askRow.id,
      promptVariables
    );

    const systemPrompt = agentConfig.systemPrompt;
    const modelConfig = agentConfig.modelConfig;
    const userPrompt = userMessage;

    console.log('Starting streaming with model:', modelConfig.provider);
    console.log('System prompt:', systemPrompt);
    console.log('User prompt:', userPrompt);

    // Créer un log simple pour le streaming
    const logId = crypto.randomUUID();
    
    // Insérer le log initial
    const { error: logError } = await supabase
      .from('ai_agent_logs')
      .insert({
        id: logId,
        agent_id: null, // Pas d'agent pour le streaming simple
        model_config_id: null, // Pas de config modèle pour le streaming simple
        ask_session_id: askRow.id, // Maintenant on a la session
        interaction_type: 'ask.chat.response.streaming',
        request_payload: {
          systemPrompt,
          userPrompt: userMessage,
          model: modelConfig.provider,
          streaming: true,
          sessionKey: key // Stocker la clé de session dans le payload
        },
        status: 'processing'
      });

    if (logError) {
      console.error('Error creating log:', logError);
    }

    // Créer la réponse en streaming
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullContent = '';
          const startTime = Date.now();
          
          console.log('Starting streaming...');
          
          for await (const chunk of callModelProviderStream(
            modelConfig,
            {
              systemPrompt,
              userPrompt,
              maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
            }
          )) {
            console.log('Received chunk:', chunk.content, 'done:', chunk.done);
            
            if (chunk.content) {
              fullContent += chunk.content;
              
              // Envoyer le chunk au client
              const data = JSON.stringify({
                type: 'chunk',
                content: chunk.content,
                done: chunk.done
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }

            if (chunk.done) {
              console.log('Streaming completed. Full content:', fullContent);
              
              // Persister le message AI en base de données
              if (fullContent.trim()) {
                const aiMetadata = { senderName: 'Agent' };
                
                const { data: insertedRows, error: insertError } = await supabase
                  .from('messages')
                  .insert({
                    ask_session_id: askRow.id,
                    content: fullContent.trim(),
                    sender_type: 'ai',
                    message_type: 'text',
                    metadata: aiMetadata,
                  })
                  .select('id, ask_session_id, user_id, sender_type, content, message_type, metadata, created_at')
                  .limit(1);

                if (insertError) {
                  console.error('Error inserting AI message:', insertError);
                } else {
                  console.log('AI message persisted with ID:', insertedRows?.[0]?.id);
                }
              }
              
              // Mettre à jour le log avec la réponse complète
              const endTime = Date.now();
              const latency = endTime - startTime;
              
              const { error: updateError } = await supabase
                .from('ai_agent_logs')
                .update({
                  status: 'completed',
                  response_payload: {
                    content: fullContent,
                    streaming: true,
                    chunks: fullContent.length
                  },
                  latency_ms: latency
                })
                .eq('id', logId);

              if (updateError) {
                console.error('Error updating log:', updateError);
              }
              
              // Envoyer le signal de fin
              controller.enqueue(encoder.encode(`data: {"type": "done"}\n\n`));
              controller.close();
            }
          }
        } catch (error) {
          console.error('Streaming error:', error);
          
          // Marquer le log comme échoué
          const { error: failError } = await supabase
            .from('ai_agent_logs')
            .update({
              status: 'failed',
              error_message: error instanceof Error ? error.message : 'Unknown error'
            })
            .eq('id', logId);

          if (failError) {
            console.error('Error updating failed log:', failError);
          }
          
          const errorData = JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Error in simple streaming endpoint:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
