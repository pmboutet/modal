-- Migration: Fix initial greeting to include participant_name
-- Issue: The initial greeting doesn't include participant_name, so AI doesn't know who it's talking to

UPDATE ai_agents
SET user_prompt = '{{#if (notEmpty completed_steps_summary)}}
Conversation avec  ⟦⟦{{ participant_details }}. ⟧⟧


Vous avez déjà franchi plusieurs étapes. Voici le résumé des étapes précédentes :
 ⟦⟦ {{ completed_steps_summary }}⟧⟧

{{/if}}
{{#if (notEmpty messages_json)}}
Tu es dans une conversation avec {{ participant_name }} voici l''historique des messages que vous avez échangé:
⟦⟦ {{step_messages_json}} ⟧⟧


Le participant vient de te répondre :
⟦⟦
{{latest_user_message}}
⟧⟧

{{#if (eq is_overtime "true")}}⚠️ **DÉPASSEMENT +{{overtime_minutes}}min → CONCLURE** ATTENTION IMPORTANT, tu es HORS DELAIS, MARQUE LE STEP COMPLETE -> ECRIS STEP_COMPLETE:{{current_step_id}}{{/if}}
{{#if (eq step_is_overtime "true")}}⚠️ **STEP +{{step_overtime_minutes}}min → PASSER** IMPORTANT TU AS DEPASSE le temps imparti pour ce STEP, PASSE AU STEP SUIVANT!! Marque le step comme complete et pose la question suivante. ecris STEP_COMPLETE:{{current_step_id}}{{/if}}
{{#if (eq step_is_overtime "false")}}
Continue la conversation en posant ta prochaine question.
Sauf si nécessaire, pas de rephrase, plutôt un mot d''empathie Pause direct ta question.
{{/if}}
{{else}}
{{#if participant_name}}Tu parles à {{ participant_name }}.{{/if}}
Commence la session avec un message d''accueil personnalisé et ta première question.
{{/if}}

'
WHERE slug = 'ask-conversation-response';
