import {
    createComponent,
    createIntegration,
    RuntimeContext,
    RuntimeEnvironment,
} from '@gitbook/runtime';

/**
 * GitBook custom block that embeds a code-walkthrough lesson.
 *
 * This code runs on GitBook's backend and only describes the block (ContentKit).
 * The player itself runs in a <webframe>: an iframe pointing at code-walkthrough's
 * embed.html, hosted wherever the "Player URL" setting says.
 */

type AccountConfiguration = { player_url?: string };
type Context = RuntimeContext<RuntimeEnvironment<AccountConfiguration>>;

/** Stored in the page, so every reader sees the same lesson. */
type Props = {
    lesson?: string;
    /** Audio language for multilingual lessons; empty = the reader's browser language. */
    language?: string;
};

/** Values of the editor-only selects. */
type State = {
    lesson: string;
    language: string;
};

type Action = { action: 'lesson.change' } | { action: 'language.change' };

type LessonEntry = { id: string; title: string; summary?: string };

const LESSON_ID = /^[a-z0-9][a-z0-9_-]*$/i;
const LANGUAGE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;

/** Rough size of the stacked player at GitBook's content width; embed.html reports the real height. */
const INITIAL_ASPECT_RATIO = 0.65;

function playerBase(context: Context): string | null {
    const raw = context.environment.installation?.configuration?.player_url?.trim();
    if (!raw) return null;
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        // A link to index.html or embed.html also works: use its folder.
        url.pathname = url.pathname.replace(/[^/]*\.html$/, '');
        if (!url.pathname.endsWith('/')) url.pathname += '/';
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
}

function embedUrl(base: string, props: Props, theme: 'light' | 'dark'): string {
    const url = new URL('embed.html', base);
    url.searchParams.set('lesson', props.lesson ?? '');
    if (props.language) url.searchParams.set('lang', props.language);
    url.searchParams.set('theme', theme);
    return url.toString();
}

/** Lesson and language from a pasted player link: embed.html?lesson=x&lang=y or index.html#x. */
function parsePlayerLink(link: string): Props | null {
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return null;
    }
    const lesson = url.searchParams.get('lesson') ?? url.hash.slice(1);
    if (!LESSON_ID.test(lesson)) return null;
    const language = url.searchParams.get('lang') ?? '';
    return { lesson, language: LANGUAGE.test(language) ? language : '' };
}

async function fetchJson<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        return null;
    }
}

async function loadLessons(base: string): Promise<LessonEntry[] | null> {
    const list = await fetchJson<LessonEntry[]>(new URL('lessons/index.json', base).toString());
    if (!Array.isArray(list)) return null;
    return list.filter((l) => l && typeof l.id === 'string' && LESSON_ID.test(l.id));
}

async function loadLanguages(base: string, lesson: string): Promise<string[]> {
    if (!LESSON_ID.test(lesson)) return [];
    const data = await fetchJson<{ languages?: unknown }>(
        new URL(`lessons/${lesson}/lesson.json`, base).toString(),
    );
    const languages = Array.isArray(data?.languages) ? data.languages : [];
    return languages.filter((l): l is string => typeof l === 'string' && LANGUAGE.test(l));
}

const walkthroughBlock = createComponent<Props, State, Action, Context>({
    componentId: 'walkthrough',

    initialState: (props) => ({
        lesson: props.lesson ?? '',
        language: props.language ?? '',
    }),

    async action(element, action) {
        switch (action.action) {
            case '@link.unfurl': {
                const props = parsePlayerLink(action.url);
                if (!props) return undefined;
                return { props, state: { lesson: props.lesson ?? '', language: props.language ?? '' } };
            }
            case 'lesson.change': {
                // Another lesson may not have the same languages: back to automatic.
                const lesson = LESSON_ID.test(element.state.lesson) ? element.state.lesson : '';
                return { props: { lesson, language: '' }, state: { lesson, language: '' } };
            }
            case 'language.change': {
                const language = LANGUAGE.test(element.state.language) ? element.state.language : '';
                return {
                    props: { ...element.props, language },
                    state: { ...element.state, language },
                };
            }
        }
        return undefined;
    },

    async render(element, context) {
        const base = playerBase(context);
        if (!base) {
            return (
                <block>
                    <markdown content="**Code walkthrough:** set the *Player URL* in this integration's settings (Integrations → Code Walkthrough)." />
                </block>
            );
        }

        const { props } = element;
        const hasLesson = !!props.lesson && LESSON_ID.test(props.lesson);
        const editable = element.context.type === 'document' && element.context.editable;

        const frame = hasLesson ? (
            <webframe
                source={{ url: embedUrl(base, props, element.context.theme) }}
                aspectRatio={INITIAL_ASPECT_RATIO}
            />
        ) : null;

        // Readers only see the player.
        if (!editable) {
            return <block>{frame ?? <markdown content="_No lesson selected._" />}</block>;
        }

        // Editors also get the lesson (and language) picker above it.
        const [lessons, languages] = await Promise.all([
            loadLessons(base),
            hasLesson ? loadLanguages(base, props.lesson!) : Promise.resolve([]),
        ]);

        const lessonPicker = lessons ? (
            <select
                state="lesson"
                initialValue={props.lesson ?? ''}
                placeholder="Choose a lesson"
                options={lessons.map((l) => ({ id: l.id, label: l.title || l.id }))}
                onValueChange={{ action: 'lesson.change' }}
            />
        ) : (
            // index.json could not be loaded: type the lesson folder name instead.
            <textinput state="lesson" initialValue={props.lesson ?? ''} placeholder="lesson-id" />
        );

        const controls = [
            <input label="Lesson" element={lessonPicker} />,
            ...(lessons
                ? []
                : [<button label="Show lesson" onPress={{ action: 'lesson.change' }} />]),
            ...(languages.length > 1
                ? [
                      <input
                          label="Audio"
                          element={
                              <select
                                  state="language"
                                  initialValue={props.language ?? ''}
                                  options={[
                                      { id: '', label: "Reader's language" },
                                      ...languages.map((l) => ({ id: l, label: l.toUpperCase() })),
                                  ]}
                                  onValueChange={{ action: 'language.change' }}
                              />
                          }
                      />,
                  ]
                : []),
        ];

        return (
            <block>
                <vstack>
                    <hstack>{controls}</hstack>
                    {frame ?? (
                        <markdown
                            content={
                                lessons
                                    ? 'Choose a lesson above.'
                                    : `Could not load the lesson list from \`${base}lessons/index.json\`. Type a lesson folder name instead.`
                            }
                        />
                    )}
                </vstack>
            </block>
        );
    },
});

export default createIntegration<Context>({
    components: [walkthroughBlock],
});
