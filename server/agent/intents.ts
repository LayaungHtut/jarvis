/**
 * Deterministic intent planner, expressed as Prolog rules.
 *
 * Each `intent(Command, Priority, Tool, Args)` clause maps a lowercased command
 * to a single tool call. Adding a capability = adding one rule; conflict
 * resolution between competing intents is declarative via the priority number
 * and rule ordering. Prolog backtracking can also expose alternative candidate
 * intents when the first tool fails (see Planner.planAlternatives).
 */
export const INTENTS_PROGRAM = `:- use_module(library(lists)).

% ------------------------------------------------------------------
% string / word utilities
% ------------------------------------------------------------------
contains(Text, Sub) :- find_first(Text, Sub, _).

starts_with(Text, Prefix) :- atom_concat(Prefix, _, Text).

prefix(Text, Len, Prefix) :- sub_atom(Text, 0, Len, _, Prefix).
suffix(Text, Len, Suffix) :-
	atom_length(Text, Ln),
	Start is Ln - Len,
	sub_atom(Text, Start, Len, 0, Suffix).

% Terminating substring search. Tau Prolog's sub_atom/5 loops forever when
% the subatom is absent, so we search over code lists with append/3.
find_first(Text, Sub, Before) :-
	\\+(Sub = ''),
	atom_codes(Text, TC),
	atom_codes(Sub, SC),
	sublist(SC, TC, Before).

sublist(P, L, B) :-
	\\+(P = []),
	scan(P, L, 0, B).
scan(P, L, N, B) :-
	( prefix_list(P, L) -> B = N
	; L = [_|Tail], N1 is N + 1, scan(P, Tail, N1, B) ).
prefix_list([], _).
prefix_list([X|Ps], [X|Ls]) :- prefix_list(Ps, Ls).
len([], 0).
len([_|Xs], N) :- len(Xs, N0), N is N0 + 1.

find_seam(Text, Seam, Before, After) :-
	\\+(Seam = ''),
	atom_codes(Text, TC),
	atom_codes(Seam, SC),
	sublist(SC, TC, Before),
	atom_length(Seam, SL),
	atom_length(Text, TL),
	After is TL - Before - SL.

letter(C) :- atom_length(C, 1), between(97, 122, Code), char_code(C, Code).
digit_char(C) :- atom_length(C, 1), atom_codes(C, [Code]), between(48, 57, Code).
word_char(C) :- letter(C).
word_char(C) :- digit_char(C).
word_char('_').

boundary_before(_Text, 0).
boundary_before(Text, Before) :-
	Before > 0,
	BeforeMinus is Before - 1,
	sub_atom(Text, BeforeMinus, 1, _, Prev),
	\\+(word_char(Prev)).

boundary_after(Text, After) :-
	atom_length(Text, Ln),
	( After >= Ln -> true ; (sub_atom(Text, After, 1, _, Next), \\+(word_char(Next))) ).

word_occ(Text, Word, Before) :-
	find_first(Text, Word, Before),
	boundary_before(Text, Before).

word_occ2(Text, Word, Before) :-
	find_first(Text, Word, Before),
	boundary_before(Text, Before),
	atom_length(Word, WL),
	After is Before + WL,
	boundary_after(Text, After).

word_prefix(Text, Word) :-
	atom_concat(Word, Rest, Text),
	( Rest = '' -> true ; (sub_atom(Rest, 0, 1, _, Next), \\+(word_char(Next))) ).

skip_spaces(In, Out) :- ( atom_concat(' ', R1, In) -> skip_spaces(R1, Out) ; Out = In ).
skip_spaces1(In, Out) :- atom_concat(' ', R1, In), !, skip_spaces(R1, Out).

opt_word(Word, In, Out) :-
	atom_concat(Word, Rest, In),
	( Rest = '' -> Out = Rest ; skip_spaces1(Rest, Out) ), !.
opt_word(_Word, In, In).

trim_trailing(In, Out) :-
	atom_length(In, Ln),
	( Ln = 0 -> Out = In
	; ( Lnm is Ln - 1, sub_atom(In, Lnm, 1, _, Last), Last = ' ' ->
		sub_atom(In, 0, Lnm, _, Mid), trim_trailing(Mid, Out)
	  ; Out = In ) ).

to_num(A, N) :- atom_codes(A, Cs), number_codes(N, Cs).

digit3(In, Digits, Tail) :-
	atom_chars(In, Chars),
	take_up_to_3(Chars, 3, DChars, RChars),
	\\+(DChars = []),
	atom_chars(Digits, DChars),
	atom_chars(Tail, RChars).
take_up_to_3([C|Cs], N, [C|Ds], R) :-
	N > 0,
	digit_char(C),
	N1 is N - 1,
	take_up_to_3(Cs, N1, Ds, R).
take_up_to_3(Cs, _N, [], Cs).

id_char(C) :- letter(C).
id_char(C) :- digit_char(C).
id_char('_').
id_start(C) :- letter(C).
id_start('_').
id_token(In, Id, Tail) :-
	atom_chars(In, Chars),
	id_run(Chars, IdChars, TailChars),
	atom_chars(Id, IdChars),
	atom_chars(Tail, TailChars),
	IdChars = [First|_],
	id_start(First).
id_run([C|Cs], [C|Is], R) :- id_char(C), !, id_run(Cs, Is, R).
id_run(Cs, [], Cs).

path_char(C) :- word_char(C).
path_char(C) :- member(C, ['.', '-', '/', '\\\\']).
path_run(In, Out, Tail) :-
	atom_chars(In, Chars),
	take_path(Chars, PChars, TailChars),
	atom_chars(Out, PChars),
	atom_chars(Tail, TailChars),
	\\+(PChars = []).
take_path([], [], []).
take_path([C|Cs], [C|Ps], R) :- path_char(C), !, take_path(Cs, Ps, R).
take_path(Cs, [], Cs).

min_list([X], X).
min_list([X|Xs], M) :- min_list(Xs, M0), (X < M0 -> M = X ; M = M0).

numeric(Target) :-
	\\+(Target = ''),
	atom_codes(Target, Cs),
	\\+(Cs = []),
	maplist(is_digit_code, Cs).
is_digit_code(C) :- between(48, 57, C).

% ------------------------------------------------------------------
% application keywords and longest-keyword selection
% ------------------------------------------------------------------
app_keyword('vscode'). app_keyword('code'). app_keyword('chrome'). app_keyword('telegram').
app_keyword('notepad'). app_keyword('terminal'). app_keyword('cmd'). app_keyword('explorer').
app_keyword('spotify'). app_keyword('calculator'). app_keyword('paint'). app_keyword('word').
app_keyword('excel').

% Runtime-learnable friendly-name aliases (extensible via assert_app_alias/2).
:- dynamic(app_alias/2).
app_alias('vs', 'code'). app_alias('vscode', 'code'). app_alias('studio code', 'code').

assert_app_alias(Alias, App) :-
	\\+(Alias = ''),
	\\+(App = ''),
	( app_alias(Alias, App) -> true ; asserta(app_alias(Alias, App)) ).

% Levenshtein-style distance bounded by N (edit budget). Succeeds when two
% code lists are within N insertions/deletions/substitutions/transpositions
% of each other. The extra branch swaps adjacent characters so typos like
% "chorme"→chrome or "termianl"→terminal cost a single edit.
lev([], L, N) :- len(L, N).
lev(L, [], N) :- len(L, N).
lev([X|Xs], [Y|Ys], N) :-
	( X = Y -> lev(Xs, Ys, N)
	; N > 0,
	  N1 is N - 1,
	  ( lev([X|Xs], Ys, N1) ; lev(Xs, [Y|Ys], N1) ; lev(Xs, Ys, N1)
	  ; ( Xs = [X2|Xs2], Ys = [Y2|Ys2], X = Y2, X2 = Y, lev(Xs2, Ys2, N1) ) ) ).

% fuzzy_occurs(Word, Text): the keyword matches inside Text within one edit
% of a contiguous window (typo tolerance for app names).
fuzzy_occurs(Word, Text) :-
	atom_codes(Text, TC),
	atom_codes(Word, WC),
	try_fuzzy(WC, TC).

try_fuzzy(P, L) :-
	( between(0, 1, N), lev(P, L, N) -> true
	; L = [_|Tail], try_fuzzy(P, Tail) ).

pick_app(Target, App) :- app_alias(Target, App), !.
pick_app(Target, App) :-
	findall(K, (app_keyword(K), contains(Target, K)), Kws),
	Kws = [_|_],
	longest_kw(Kws, App), !.
pick_app(Target, App) :-
	findall(K, (app_keyword(K), fuzzy_occurs(K, Target)), Fws),
	Fws = [_|_],
	longest_kw(Fws, App), !.
pick_app(Target, Target).
longest_kw([K], K).
longest_kw([K|Ks], Best) :-
	longest_kw(Ks, B),
	atom_length(K, LK),
	atom_length(B, LB),
	( LK > LB -> Best = K ; Best = B ).

% ------------------------------------------------------------------
% google / gmail account intents — "open shirogami ryuu google account"
% ------------------------------------------------------------------
google_account_marker(M) :-
	member(M, ['google accounts', 'google account', 'google acc',
	           'gmail accounts', 'gmail account', 'gmail acc',
	           'google mail account', 'g account', 'g accounts']).

google_account_present(Text) :-
	google_account_marker(M),
	word_occ2(Text, M, _).

% Position of a marker that is bounded on both sides (avoids matching
% 'google acc' inside 'google account').
ga_before(Command, M, Pre) :-
	word_occ2(Command, M, Before),
	Before > 0,
	prefix(Command, Before, Pre0),
	trim_trailing(Pre0, Pre).

ga_after(Command, M, Post) :-
	word_occ2(Command, M, Before),
	atom_length(M, ML),
	After is Before + ML,
	sub_atom(Command, After, _, 0, R0),
	skip_spaces(R0, R1),
	opt_word('named', R1, R2),
	skip_spaces(R2, R3),
	\\+(R3 = ''),
	Post = R3.

% Strip lead-in verbs/particles so "switch to shirogami ryuu" -> "shirogami ryuu".
strip_open_lead(In, Out) :-
	member(P, ['switch to ', 'switch ', 'change to ', 'change ', 'swap to ',
	           'go to ', 'log into ', 'log in to ', 'sign into ', 'sign in to ',
	           'open ', 'launch ', 'start ', 'the ', 'my ']),
	atom_concat(P, R1, In),
	skip_spaces(R1, R2),
	\\+(R2 = ''),
	strip_open_lead(R2, Out), !.
strip_open_lead(In, Out) :- trim_trailing(In, Out).

ga_candidate(Command, Name) :-
	google_account_marker(M),
	( ga_before(Command, M, Pre), strip_open_lead(Pre, Name)
	; ga_after(Command, M, Post), strip_open_lead(Post, Name) ).

longest_ga([N], N).
longest_ga([A|Rest], Best) :-
	longest_ga(Rest, B),
	atom_length(A, LA),
	atom_length(B, LB),
	( LA >= LB -> Best = A ; Best = B ).

ga_name(Command, Name) :-
	findall(N, ga_candidate(Command, N), Names),
	longest_ga(Names, Name),
	\\+(Name = '').

% A bare email address after an open verb means a Google account.
ga_email(Command, Name) :-
	split_open(Command, Target),
	contains(Target, '@'),
	strip_open_lead(Target, Name),
	\\+(Name = '').

google_account_name(Command, Name) :-
	( ga_name(Command, Name) ; ga_email(Command, Name) ), !.

% ------------------------------------------------------------------
% "open X" / compound "open X and write Y"
% ------------------------------------------------------------------
open_verb('open'). open_verb('launch'). open_verb('start').

split_open(Text, Target) :-
	open_verb(V),
	word_occ(Text, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, Tail0),
	skip_spaces1(Tail0, Tail),
	\\+(Tail = ''),
	Target = Tail.

write_verb('write'). write_verb('create'). write_verb('make'). write_verb('save').

seam(Verb, Seam) :-
	member(Sep, [' and ', ' then ']),
	member(Also, ['', 'also ']),
	atom_concat(Sep, Also, S1),
	atom_concat(S1, Verb, S2),
	atom_concat(S2, ' ', Seam).

compound_split(Text, App, Verb, Rest) :-
	write_verb(Verb),
	seam(Verb, Seam),
	find_seam(Text, Seam, Before, After),
	Before > 0,
	After > 0,
	prefix(Text, Before, AppRaw),
	trim_trailing(AppRaw, App),
	suffix(Text, After, Rest).

open_compound(Command) :-
	split_open(Command, Target),
	compound_split(Target, _, _, _).

generic_open(Command, Tool, Args) :-
	\\+(list_windows_pattern(Command)),
	\\+ google_account_present(Command),
	\\+ open_path_lead(Command),
	split_open(Command, Target),
	\\+(compound_split(Target, _, _, _)),
	open_kind(Target, Command, Tool, Args).

open_kind(Target, _Command, open_url, [url(Target)]) :- starts_with(Target, 'http'), !.
open_kind(Target, _Command, open_application, [application(App)]) :-
	app_kw_present(Target), pick_app(Target, App), !.
open_kind(Target, Command, search_web, [query(Target)]) :-
	( contains(Command, 'search') ; contains(Command, 'youtube') ), !.
open_kind(Target, _Command, open_application, [application(App)]) :- pick_app(Target, App).

app_kw_present(Target) :- app_keyword(K), contains(Target, K).

strip_write_prefix(Text, Clause) :-
	write_verb(V),
	atom_concat(V, ' ', P0),
	starts_with(Text, P0),
	atom_concat(P0, R0, Text),
	skip_spaces(R0, R1),
	opt_word('a', R1, R2),
	opt_word('file', R2, R3),
	skip_spaces(R3, Clause).

content_marker('with'). content_marker('containing'). content_marker('content').

content_split_at(Text, M, Path, Raw) :-
	atom_concat(' ', M, SM),
	atom_concat(SM, ' ', Seam),
	find_seam(Text, Seam, Before, After),
	prefix(Text, Before, Path),
	suffix(Text, After, Raw).

content_split(Clause, Path, Raw) :-
	content_marker(M),
	content_split_at(Clause, M, Path, Raw), !.
content_split(Clause, Clause, '').

normalize_alt(Raw, Out) :- atom_concat('content ', Out, Raw).
normalize_alt(Raw, Out) :- atom_concat('text ', Out, Raw).
normalize_alt(Raw, Out) :- atom_concat('the text ', Out, Raw).
normalize_alt(Raw, Raw).
normalize_content(Raw, Out) :- normalize_alt(Raw, Out), !.

parse_write(Clause, Path, Content) :-
	content_split(Clause, Path, Raw),
	normalize_content(Raw, C),
	( C = '' -> Content = 'Created by JARVIS.' ; Content = C ).

generic_write(Command, Clause) :-
	write_verb(V),
	word_occ(Command, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('a', R1, R2),
	opt_word('file', R2, R3),
	skip_spaces(R3, R4),
	\\+(R4 = ''),
	Clause = R4.

compound_write(Command, Path, Content) :-
	split_open(Command, Target),
	compound_split(Target, _App, Verb, Rest),
	atom_concat(Verb, ' ', PV),
	atom_concat(PV, Rest, Full),
	strip_write_prefix(Full, Clause),
	parse_write(Clause, Path, Content).

% ------------------------------------------------------------------
% search / system / windows / screenshot
% ------------------------------------------------------------------
has_open_launch(Command) :- open_verb(V), word_occ(Command, V, _).

search_query(Text, Query) :-
	word_occ(Text, 'search', Before),
	atom_length('search', VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces(R0, R1),
	( atom_concat('for', R2, R1), skip_spaces(R2, R3) ; R3 = R1 ),
	\\+(R3 = ''),
	Query = R3.

system_kw('system'). system_kw('cpu'). system_kw('memory'). system_kw('ram').
system_kw('disk'). system_kw('hardware'). system_kw('battery').
how_doing(Text) :- contains(Text, 'how'), ( contains(Text, 'doing') ; contains(Text, 'runn') ).

computer_name_q(Text) :-
	( contains(Text, 'computer name') ; contains(Text, 'hostname')
	; contains(Text, 'machine name') ; contains(Text, 'device name')
	; ( contains(Text, 'computer'), contains(Text, 'name') )
	; ( contains(Text, 'host'), contains(Text, 'name') ) ).

list_windows_pattern(Text) :-
	\\+ contains(Text, 'processes'),
	( (contains(Text, 'what'), (contains(Text, 'open') ; contains(Text, 'running') ; contains(Text, 'window')))
	; (contains(Text, 'list'), contains(Text, 'windows')) ).

% ------------------------------------------------------------------
% run / tests / files
% ------------------------------------------------------------------
tests_pattern(Text) :-
	( contains(Text, 'run the tests') ; contains(Text, 'run the unit tests')
	; contains(Text, 'run tests') ; contains(Text, 'run unit tests')
	; contains(Text, 'tests are failing') ; contains(Text, 'build failing')
	; contains(Text, 'why is my build failing') ).

read_path(Text, Path) :-
	word_occ(Text, 'read', Before),
	atom_length('read', VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('the', R1, R2),
	opt_word('file', R2, R3),
	skip_spaces(R3, R4),
	\\+(R4 = ''),
	Path = R4.

run_verb('run'). run_verb('execute').
run_capture(Text, Cmd) :-
	run_verb(V),
	word_occ(Text, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	\\+(R1 = ''),
	Cmd = R1.

% ------------------------------------------------------------------
% close / kill
% ------------------------------------------------------------------
close_verb('close'). close_verb('quit').
anchored_verb(V, Text, Target) :-
	atom_concat(V, ' ', P0),
	starts_with(Text, P0),
	atom_concat(P0, R0, Text),
	skip_spaces(R0, R1),
	\\+(R1 = ''),
	Target = R1.

% ------------------------------------------------------------------
% volume / media
% ------------------------------------------------------------------
volume_set(Text, Digits) :-
	word_occ(Text, 'volume', Before),
	atom_length('volume', VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces(R0, R1),
	opt_word('to', R1, R2),
	skip_spaces(R2, R3),
	digit3(R3, Digits, _Tail).

optional_digits(In, DigitsAtom) :- digit3(In, DigitsAtom, _), !.
optional_digits(_In, '').

volume_delta(Text, Dir, DigitsAtom) :-
	word_occ(Text, 'volume', Before),
	atom_length('volume', VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	member(Dir, [up, down]),
	atom_concat(Dir, R2, R1),
	skip_spaces(R2, R3),
	opt_word('by', R3, R4),
	skip_spaces(R4, R5),
	optional_digits(R5, DigitsAtom).

media_verb('play'). media_verb('pause'). media_verb('resume'). media_verb('next').
media_verb('previous'). media_verb('prev'). media_verb('skip').
media_target(Text) :-
	( contains(Text, 'music') ; contains(Text, 'song') ; contains(Text, 'track')
	; contains(Text, 'media') ; contains(Text, 'video') ; contains(Text, 'spotify') ).
action_for('next', 'next'). action_for('skip', 'next').
action_for('previous', 'previous'). action_for('prev', 'previous').
action_for('play', 'play_pause'). action_for('pause', 'play_pause').
action_for('resume', 'play_pause').
media_action('next', 'next'). media_action('skip', 'next').
media_action('previous', 'previous'). media_action('prev', 'previous').
media_action('pause', 'play_pause'). media_action('resume', 'play_pause').

% True when a media control word (next/skip/previous/prev/pause/resume) occurs
% in the command — i.e. a transport action rather than a specific track query.
media_control_word(Command, Action) :-
	media_action(Ctl, Action),
	word_occ(Command, Ctl, _).

media_filler('music'). media_filler('song'). media_filler('track'). media_filler('video'). media_filler('media').

% Strip leading generic media words so "play music from me eain shin" yields
% "me eain shin". Fully consuming a filler-only tail yields '' (generic play).
% The trailing cut commits to the first result: otherwise the Out = S0
% fallback re-fires after backtracking and leaks the unstripped text.
strip_media_fillers(In, Out) :-
	skip_spaces(In, S0),
	( ( media_filler(F),
	    atom_concat(F, R1, S0),
	    ( R1 = '' -> Out = '' ; skip_spaces1(R1, S1), \\+(S1 = ''), strip_media_fillers(S1, Out) ) )
	; Out = S0 ), !.

strip_prep(In, Out) :-
	member(P, ['from ', 'by ', 'the ', 'to ', 'a ', 'some ']),
	atom_concat(P, R1, In),
	skip_spaces(R1, R2),
	Out = R2, !.
strip_prep(In, In).

normalize_media(In, Out) :-
	strip_prep(In, A),
	strip_media_fillers(A, B),
	strip_prep(B, C),
	strip_media_fillers(C, Out).

% media_query(Text, Query): capture the specific song/artist after a play verb,
% ignoring filler/preposition words. Fails for generic commands like "play music".
media_query(Text, Q) :-
	member(V, ['play', 'listen']),
	word_occ(Text, V, B),
	atom_length(V, VL),
	End is B + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	\\+(R1 = ''),
	normalize_media(R1, Q),
	\\+(Q = '').

% ------------------------------------------------------------------
% copy / clipboard
% ------------------------------------------------------------------
copy_file_split(Text, Src, Dst) :-
	word_occ(Text, 'copy', Before),
	atom_length('copy', VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('file', R1, R2),
	skip_spaces(R2, R3),
	path_run(R3, Src, Tail),
	( looks_like_path(Src) ; looks_like_path(R3) ),
	skip_spaces1(Tail, T0),
	atom_concat('to', T1, T0),
	skip_spaces1(T1, T2),
	path_run(T2, Dst, _).

looks_like_path(Text) :-
	( contains(Text, '.') ; contains(Text, '/') ; contains(Text, '\\\\')
	; contains(Text, ':') ; contains(Text, '_') ).
copy_capture(Text, Out) :-
	member(V, ['copy', 'clipboard']),
	word_occ(Text, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	\\+(R1 = ''),
	Out = R1.

strip_clipboard_suffix(In, Out) :-
	find_seam(In, ' to the clipboard', Before, _),
	prefix(In, Before, Mid),
	trim_trailing(Mid, Out), !.
strip_clipboard_suffix(In, Out) :-
	find_seam(In, ' to clipboard', Before, _),
	prefix(In, Before, Mid),
	trim_trailing(Mid, Out), !.
strip_clipboard_suffix(In, In).

clipboard_write_text(Text, Out) :-
	copy_capture(Text, Raw),
	strip_clipboard_suffix(Raw, Out),
	atom_length(Out, Len),
	Len > 0.

clipboard_write_ok(Command, Out) :-
	clipboard_write_text(Command, Out),
	( looks_like_path(Out) -> fail ; true ).

clipboard_readish(Text) :-
	( word_occ(Text, 'clipboard', Before),
	  atom_length('clipboard', VL), End is Before + VL,
	  sub_atom(Text, End, _, 0, R0), skip_spaces(R0, R1),
	  ( atom_concat('read', _, R1) ; atom_concat('show', _, R1) ) )
	; ( contains(Text, 'what'), contains(Text, 'clipboard') )
	; ( ( contains(Text, 'read') ; contains(Text, 'show') ), contains(Text, 'clipboard') ).

% ------------------------------------------------------------------
% focus / mouse / typing / lock / screen
% ------------------------------------------------------------------
focus_verb('focus'). focus_verb('bring up'). focus_verb('switch to').

mouse_coords(Text, X, Y) :-
	word_occ(Text, 'mouse', Before),
	atom_length('mouse', VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces(R0, R1),
	opt_word('cursor', R1, R2),
	atom_concat('to', R3, R2),
	skip_spaces1(R3, R4),
	coord_pair(R4, X, Y).

coord_pair(Text, X, Y) :-
	digit3(Text, XAtom, Tail),
	skip_spaces(Tail, T0),
	atom_concat(',', T1, T0),
	skip_spaces(T1, T2),
	digit3(T2, YAtom, _),
	to_num(XAtom, X),
	to_num(YAtom, Y).

click_coords(Text, X, Y) :-
	word_occ(Text, 'click', Before),
	atom_length('click', VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('at', R1, R2),
	skip_spaces(R2, R3),
	coord_pair(R3, X, Y).

type_capture(Text, Out) :-
	word_occ(Text, 'type', Before),
	atom_length('type', VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	( (skip_spaces(R0, S0), atom_concat('out', S1, S0), skip_spaces1(S1, S2), \\+(S2 = ''), Out = S2)
	; (skip_spaces1(R0, S3), \\+(S3 = ''), Out = S3) ).

lock_screen_pattern(Text) :-
	word_occ(Text, 'lock', Before),
	atom_length('lock', VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('the', R1, R2),
	skip_spaces(R2, R3),
	member(W, ['screen', 'computer', 'pc', 'workstation']),
	word_prefix(R3, W).

ui_list_pattern(Text) :-
	( contains(Text, 'what buttons') ; contains(Text, 'what controls') ; contains(Text, 'what ui')
	; contains(Text, 'show me the buttons') ; contains(Text, 'show me the controls')
	; contains(Text, 'show me the ui') ; contains(Text, 'show me the menu')
	; (contains(Text, 'list'), (contains(Text, 'buttons') ; contains(Text, 'controls'))) ).

ui_widget('button'). ui_widget('control'). ui_widget('icon').
ui_widget('menu item'). ui_widget('link').
widget_at(Text, B) :- ui_widget(W), word_occ2(Text, W, B).

click_quote(Text, Name) :-
	word_occ(Text, 'click', Before),
	atom_length('click', VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('on', R1, R2),
	skip_spaces(R2, R3),
	sub_atom(R3, 0, 1, _, Quote),
	( Quote = "'" ; Quote = '"' ),
	atom_concat(Quote, Rest, R3),
	find_first(Rest, Quote, Before2),
	prefix(Rest, Before2, Name),
	\\+(Name = '').

click_label(Text, Name) :-
	word_occ(Text, 'click', Before),
	atom_length('click', VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('on', R1, R2),
	skip_spaces(R2, R3),
	opt_word('the', R3, R4),
	skip_spaces(R4, R5),
	findall(B, widget_at(R5, B), Bs),
	Bs = [_|_],
	min_list(Bs, MinB),
	prefix(R5, MinB, Name0),
	trim_trailing(Name0, Name),
	\\+(Name = '').

click_control(Text, Name) :-
	word_occ(Text, 'click', Before),
	atom_length('click', VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('on', R1, R2),
	skip_spaces(R2, R3),
	opt_word('the', R3, R4),
	skip_spaces(R4, R5),
	ui_widget(W),
	word_prefix(R5, W),
	atom_concat(W, R6, R5),
	skip_spaces1(R6, R7),
	( opt_word('named', R7, R8) ; opt_word('labeled', R7, R8) ; opt_word('called', R7, R8) ),
	skip_spaces(R8, R9),
	\\+(R9 = ''),
	Name = R9.

% ------------------------------------------------------------------
% search files / power / apps / services / env
% ------------------------------------------------------------------
sf_capture(Text, Pattern) :-
	member(V, ['find', 'search']),
	word_occ(Text, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('for', R1, R2),
	skip_spaces(R2, R3),
	opt_word('the', R3, R4),
	skip_spaces(R4, R5),
	member(F, ['file', 'folder', 'document', 'files', 'folders', 'documents']),
	word_prefix(R5, F),
	atom_concat(F, R6, R5),
	skip_spaces1(R6, R7),
	opt_word('for', R7, R8),
	skip_spaces(R8, R9),
	\\+(R9 = ''),
	Pattern = R9.

power_kw(Text) :-
	( contains(Text, 'shutdown') ; contains(Text, 'restart') ; contains(Text, 'reboot')
	; contains(Text, 'hibernate') ; contains(Text, 'logoff') ; contains(Text, 'log off')
	; (contains(Text, 'shut'), contains(Text, 'down')) ).
target_word(Text) :-
	( contains(Text, 'computer') ; contains(Text, 'pc') ; contains(Text, 'system')
	; contains(Text, 'machine') ; contains(Text, 'windows') ).
power_action(Text, 'restart') :- (contains(Text, 'restart') ; contains(Text, 'reboot')), !.
power_action(Text, 'hibernate') :- contains(Text, 'hibernate'), !.
power_action(Text, 'logoff') :- (contains(Text, 'logoff') ; contains(Text, 'log off')), !.
power_action(Text, 'shutdown') :- (contains(Text, 'shutdown') ; (contains(Text, 'shut'), contains(Text, 'down'))), !.
power_action(_Text, 'sleep').

list_apps_pattern(Text) :-
	( contains(Text, 'list') ; contains(Text, 'show') ; contains(Text, 'what') ),
	( contains(Text, 'apps') ; contains(Text, 'applications') ; contains(Text, 'programs') ).

svc_verb('restart'). svc_verb('stop'). svc_verb('start').
svc_name(Text, Name) :-
	word_occ2(Text, 'service', Before),
	prefix(Text, Before, Name0),
	trim_trailing(Name0, Name),
	\\+(Name = '').

env_word(Text, Out) :-
	skip_spaces(Text, T0),
	( (atom_concat('environment', T1, T0), skip_spaces(T1, T2))
	; (atom_concat('env', T1, T0), skip_spaces(T1, T2))
	; T2 = T0 ),
	( (atom_concat('variable', T3, T2), skip_spaces(T3, Out))
	; (atom_concat('var', T3, T2), skip_spaces(T3, Out))
	; Out = T2 ).

eq_sep(Text, Out) :-
	skip_spaces(Text, T0),
	( atom_concat('to', T1, T0) ; atom_concat('as', T1, T0)
	; atom_concat('equals', T1, T0) ; atom_concat('=', T1, T0) ),
	skip_spaces(T1, Out).

env_set(Text, Name, Value) :-
	member(V, ['set', 'create']),
	word_occ(Text, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('the', R1, R2),
	skip_spaces(R2, R3),
	env_word(R3, R4),
	id_token(R4, Name0, R5),
	skip_spaces(R5, R6),
	eq_sep(R6, R7),
	skip_spaces(R7, R8),
	\\+(R8 = ''),
	Value = R8,
	Name = Name0.

env_get(Text, Name) :-
	member(V, ['what is', 'get', 'show', 'read']),
	word_occ(Text, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('the', R1, R2),
	skip_spaces(R2, R3),
	env_word(R3, R4),
	id_token(R4, Name, _Tail).

% ------------------------------------------------------------------
% clarification — verb present but nothing to act on
% ------------------------------------------------------------------
verb_only(Command, Verb) :-
	word_occ2(Command, Verb, B),
	atom_length(Verb, VL),
	End is B + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces(R0, R1),
	R1 = ''.

clarify(Command, 'Which app, file, or URL would you like me to open?') :- verb_only(Command, 'open'), !.
clarify(Command, 'What would you like me to search for?') :- verb_only(Command, 'search'), !.
clarify(Command, 'What should I close?') :- verb_only(Command, 'close'), !.
clarify(Command, 'Which process should I kill?') :- verb_only(Command, 'kill'), !.
clarify(Command, 'Which file should I read?') :- verb_only(Command, 'read'), !.
clarify(Command, 'What should I run?') :- verb_only(Command, 'run'), !.
clarify(Command, 'What would you like me to play?') :- verb_only(Command, 'play'), !.

% ------------------------------------------------------------------
% chained commands — "X then Y" / "X and <verb> Y" become ordered steps
% ------------------------------------------------------------------
action_verb('open'). action_verb('launch'). action_verb('start').
action_verb('write'). action_verb('create'). action_verb('make'). action_verb('save').
action_verb('run'). action_verb('execute'). action_verb('close'). action_verb('kill').
action_verb('play'). action_verb('search'). action_verb('copy'). action_verb('focus').
action_verb('read'). action_verb('set'). action_verb('restart'). action_verb('stop').
action_verb('move'). action_verb('rename'). action_verb('delete'). action_verb('remove').
action_verb('zip'). action_verb('compress'). action_verb('minimize'). action_verb('scroll').
action_verb('press'). action_verb('type'). action_verb('fill'). action_verb('notify').
action_verb('remember'). action_verb('erase').

and_split(Text, Before, After) :-
	find_seam(Text, ' and ', Before, After),
	B2 is Before + 5,
	sub_atom(Text, B2, After, 0, Tail0),
	skip_spaces(Tail0, Tail1),
	action_verb(V),
	starts_with(Tail1, V).

then_split(Text, Before, After) :-
	find_seam(Text, ' then ', Before, After).

first_sep(Text, B, 6, A) :- then_split(Text, B, A), !.
first_sep(Text, B, 5, A) :- and_split(Text, B, A).

split_segments(Text, Segs) :-
	( first_sep(Text, B, SeamLen, After) ->
	    prefix(Text, B, Head0),
	    trim_trailing(Head0, Head),
	    B2 is B + SeamLen,
	    sub_atom(Text, B2, After, 0, Tail),
	    split_segments(Tail, Rest),
	    Segs = [Head|Rest]
	; Segs = [Text] ).

% ------------------------------------------------------------------
% extended capabilities — folder open / dir listing / process list /
% volume read / active window / memory / page reading / press / scroll
% ------------------------------------------------------------------
folder_word('folder'). folder_word('directory'). folder_word('dir').

is_url(Target) :- starts_with(Target, 'http').
is_url(Target) :- starts_with(Target, 'www.').

strip_explorer(In, Out) :-
	find_seam(In, ' in explorer', B, _),
	prefix(In, B, Mid),
	trim_trailing(Mid, Out), !.
strip_explorer(In, In).

open_path_lead(Command) :-
	open_verb(V),
	word_occ(Command, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('the', R1, R2),
	folder_word(F),
	word_prefix(R2, F).

open_path_capture(Command, Path) :-
	open_verb(V),
	word_occ(Command, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('the', R1, R2),
	folder_word(F),
	word_occ(R2, F, B2),
	atom_length(F, FL),
	E2 is B2 + FL,
	sub_atom(R2, E2, _, 0, R3),
	skip_spaces1(R3, R4),
	opt_word('named', R4, R5),
	skip_spaces(R5, R6),
	strip_explorer(R6, R7),
	skip_spaces(R7, R8),
	( R8 = '' -> Path = '.' ; Path = R8 ).

after_word(Text, Word, Out) :-
	word_occ(Text, Word, Before),
	atom_length(Word, WL),
	End is Before + WL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, Out).

skip_fillers(In, Out) :-
	skip_spaces(In, S0),
	skip_fillers2(S0, Out).
skip_fillers2(In, Out) :-
	skip_filler(In, R) -> skip_fillers2(R, Out) ; Out = In.
skip_filler(In, Out) :-
	member(F, ['me ', 'the ', 'are ', 'is ', 'which ', 'that ', 'all ']),
	atom_concat(F, R1, In),
	skip_spaces(R1, Out).

dir_list_pattern(Command) :-
	( (contains(Command, 'files') ; contains(Command, 'contents') ; contains(Command, 'directory') ; contains(Command, 'folder')),
	  ( (contains(Command, 'list') ; contains(Command, 'show') ; contains(Command, 'what') ; contains(Command, 'find') ; contains(Command, 'search') ; contains(Command, 'in the')) ) ),
	\\+ contains(Command, 'web'),
	\\+ open_path_lead(Command).

dir_list_capture(Command, Path) :-
	( member(V, ['list', 'show']), after_word(Command, V, R1)
	; word_occ(Command, 'files', _), after_word(Command, 'files', R1) ),
	skip_fillers(R1, R2),
	opt_word('files', R2, R3),
	opt_word('contents', R3, R4),
	skip_spaces(R4, R5),
	( (atom_concat('in', R6, R5), skip_spaces1(R6, R7))
	; (atom_concat('of', R6, R5), skip_spaces1(R6, R7))
	; (atom_concat('inside', R6, R5), skip_spaces1(R6, R7))
	; R7 = R5 ),
	opt_word('the', R7, R8),
	skip_spaces(R8, R9),
	opt_word('folder', R9, R10),
	opt_word('directory', R10, R11),
	skip_spaces(R11, R12),
	strip_dir_suffix(R12, R13),
	( R13 = '' -> Path = '.' ; Path = R13 ).
dir_list_capture(Command, Path) :-
	find_seam(Command, ' in the ', B, A),
	prefix(Command, B, _),
	B2 is B + 8,
	sub_atom(Command, B2, A, 0, R0),
	skip_spaces1(R0, R1),
	folder_word(F),
	( (atom_concat(F, ' ', P), starts_with(R1, P), atom_concat(P, R2, R1), skip_spaces1(R2, R3)) ; R3 = R1 ),
	strip_dir_suffix(R3, R4),
	( R4 = '' -> Path = '.' ; Path = R4 ).

strip_dir_suffix(In, Out) :-
	find_seam(In, ' folder', Before, _),
	prefix(In, Before, Mid),
	trim_trailing(Mid, Out), !.
strip_dir_suffix(In, Out) :-
	find_seam(In, ' directory', Before, _),
	prefix(In, Before, Mid),
	trim_trailing(Mid, Out), !.
strip_dir_suffix(In, In).

process_filter(Command, Filter) :-
	word_occ(Command, 'processes', Before),
	atom_length('processes', VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	member(M, ['named', 'matching', 'like', 'such as']),
	atom_concat(M, R2, R1),
	skip_spaces1(R2, R3),
	\\+(R3 = ''),
	Filter = R3.

list_processes_pattern(Command) :-
	contains(Command, 'processes'),
	( contains(Command, 'list') ; contains(Command, 'show') ; contains(Command, 'what') ; contains(Command, 'running') ).

volume_level_q(Command) :-
	contains(Command, 'volume'),
	member(M, ['what', 'how', 'check', 'show', 'tell', 'level', 'percent', 'current']),
	contains(Command, M),
	\\+ volume_set(Command, _),
	\\+ volume_delta(Command, _, _).

active_window_q(Command) :-
	( contains(Command, 'active window') ; contains(Command, 'focused window')
	; contains(Command, 'current window') ; contains(Command, 'which window is on top')
	; contains(Command, 'which app') ; contains(Command, 'what app am')
	; contains(Command, 'which program') ; contains(Command, 'in focus') ),
	\\+ contains(Command, 'list').

remember_verb('remember'). remember_verb('note'). remember_verb('store').
remember_capture(Command, Content) :-
	remember_verb(V),
	word_occ(Command, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('that', R1, R2),
	skip_spaces(R2, R3),
	\\+(R3 = ''),
	Content = R3.

recall_word('remember'). recall_word('know'). recall_word('recall').
recall_query(Command, Query) :-
	( contains(Command, 'do you') ; contains(Command, 'what do') ; contains(Command, 'what did') ),
	recall_word(V),
	word_occ(Command, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('about', R1, R2),
	skip_spaces(R2, R3),
	\\+(R3 = ''),
	Query = R3.

read_page_url(Command, Url) :-
	find_first(Command, 'http', Before),
	sub_atom(Command, Before, _, 0, Url).
read_page_intent(Command) :-
	( contains(Command, 'read') ; contains(Command, 'summarize')
	; contains(Command, 'what does') ; contains(Command, 'what is on') ),
	read_page_url(Command, _).

minimize_verb('minimize'). minimize_verb('minimise'). minimize_verb('min').

notify_capture(Command, Title, Message) :-
	member(V, ['notify', 'remind']),
	word_occ(Command, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('me', R1, R2),
	( atom_concat('that', R3, R2), skip_spaces1(R3, R4) ; R4 = R2 ),
	( (find_seam(R4, ' saying ', B, A), prefix(R4, B, Msg0), trim_trailing(Msg0, Msg), B2 is B + 8, sub_atom(R4, B2, A, 0, T0), skip_spaces1(T0, Title))
	; (Msg = R4, Title = 'JARVIS') ),
	\\+(Msg = ''),
	Message = Msg.

move_verb('move'). move_verb('rename').
move_file_split(Text, Src, Dst) :-
	move_verb(V),
	word_occ(Text, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('file', R1, R2),
	skip_spaces(R2, R3),
	path_run(R3, Src, Tail),
	looks_like_path(Src),
	skip_spaces1(Tail, T0),
	member(Sep, ['to', 'as', 'into']),
	atom_concat(Sep, T1, T0),
	skip_spaces1(T1, T2),
	path_run(T2, Dst, _),
	\\+(Dst = '').

zip_verb('zip'). zip_verb('compress'). zip_verb('archive').
zip_capture(Command, Source, Archive) :-
	zip_verb(V),
	word_occ(Command, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('the', R1, R2),
	opt_word('folder', R2, R3),
	opt_word('directory', R3, R4),
	opt_word('named', R4, R5),
	skip_spaces(R5, R6),
	zip_split(R6, Source, Archive).

zip_split(Text, Source, Archive) :-
	find_seam(Text, 'into', B, A),
	prefix(Text, B, Src0),
	trim_trailing(Src0, Source),
	B2 is B + 4,
	sub_atom(Text, B2, A, 0, Arc0),
	skip_spaces(Arc0, Archive),
	\\+(Archive = '').
zip_split(Text, Source, Archive) :-
	find_seam(Text, 'as', B, A),
	prefix(Text, B, Src0),
	trim_trailing(Src0, Source),
	B2 is B + 2,
	sub_atom(Text, B2, A, 0, Arc0),
	skip_spaces(Arc0, Archive),
	\\+(Archive = '').
zip_split(Text, Source, Archive) :-
	Source = Text,
	atom_concat(Text, '.zip', Archive).

delete_verb('delete'). delete_verb('remove'). delete_verb('erase').
delete_capture(Command, Path) :-
	delete_verb(V),
	word_occ(Command, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('the', R1, R2),
	opt_word('file', R2, R3),
	skip_spaces(R3, R4),
	\\+(R4 = ''),
	Path = R4.

press_verb('press'). press_verb('hit').
press_key_capture(Command, Combo) :-
	press_verb(V),
	word_occ(Command, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('the', R1, R2),
	skip_spaces(R2, R3),
	\\+(R3 = ''),
	strip_key_suffix(R3, Combo).
strip_key_suffix(In, Out) :-
	suffix(In, 4, ' key'),
	atom_length(In, Ln),
	Lnm is Ln - 4,
	prefix(In, Lnm, Mid),
	trim_trailing(Mid, Out), !.
strip_key_suffix(In, In).

scroll_capture(Command, Direction, Notches) :-
	word_occ(Command, 'scroll', Before),
	atom_length('scroll', VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	member(Direction, [up, down]),
	atom_concat(Direction, R2, R1),
	skip_spaces(R2, R3),
	optional_digits(R3, Digits),
	( Digits = '' -> Notches = 1 ; to_num(Digits, Notches) ), !.

field_suffix('field'). field_suffix('box'). field_suffix('input').
strip_field_suffix(In, Out) :-
	field_suffix(F),
	atom_concat(' ', F, P),
	find_seam(In, P, Before, _),
	prefix(In, Before, Mid0),
	trim_trailing(Mid0, Mid),
	\\+(Mid = ''),
	strip_field_suffix(Mid, Out), !.
strip_field_suffix(In, In).

split_on(Text, Sep, Before, After, SeamLen) :-
	find_seam(Text, Sep, Before, After),
	Before > 0,
	After > 0,
	atom_length(Sep, SeamLen).

ui_set_into(Command, Text, Name) :-
	member(V, ['type', 'enter', 'put']),
	word_occ(Command, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	member(Sep, ['into', 'in the']),
	split_on(R1, Sep, B, A, SL),
	prefix(R1, B, Text0),
	trim_trailing(Text0, Text),
	B2 is B + SL,
	sub_atom(R1, B2, A, 0, Field0),
	skip_spaces(Field0, Field1),
	opt_word('the', Field1, Field2),
	strip_field_suffix(Field2, Name),
	\\+(Text = ''), \\+(Name = '').

ui_set_fill(Command, Name, Text) :-
	member(V, ['fill', 'set']),
	word_occ(Command, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('the', R1, R2),
	member(Sep, ['with', 'to']),
	split_on(R2, Sep, B, A, SL),
	prefix(R2, B, Name0),
	trim_trailing(Name0, Name1),
	strip_field_suffix(Name1, Name),
	B2 is B + SL,
	sub_atom(R2, B2, A, 0, Text0),
	skip_spaces(Text0, Text),
	\\+(Name = ''), \\+(Text = '').

% ------------------------------------------------------------------
% risk classification — lets the permission gate escalate on content
% ------------------------------------------------------------------
risk(Command, 'critical') :-
	( contains(Command, 'shutdown') ; contains(Command, 'reboot')
	; contains(Command, 'restart')
	; (contains(Command, 'shut'), contains(Command, 'down'))
	; contains(Command, 'format') ; contains(Command, 'delete') ), !.
risk(Command, 'high') :-
	( contains(Command, 'taskkill') ; contains(Command, 'kill')
	; contains(Command, 'rm ') ; contains(Command, 'rd /s')
	; contains(Command, 'hibernate')
	; contains(Command, 'logoff') ; contains(Command, 'log off') ), !.
risk(Command, 'low').

% ------------------------------------------------------------------
% plan / plan_excluding — ordered steps, chain-aware, with clarifications
% ------------------------------------------------------------------
chat_fallback(Seg, step(900, intent(chat, [message(Q)]))) :- clarify(Seg, Q), !.
chat_fallback(Seg, step(999, intent(chat, [message(Seg)]))).

plan_segment(Seg, Steps) :-
	findall(step(P, intent(T, A)), intent(Seg, P, T, A), Raw),
	( Raw = [] -> chat_fallback(Seg, Step), Steps = [Step] ; Steps = Raw ).

shift_priorities([], _N, []).
shift_priorities([step(P, intent(T, A))|Rest], N, [step(P1, intent(T, A))|More]) :-
	P1 is P + N,
	shift_priorities(Rest, N, More).

plan_segments([], _N, []).
plan_segments([Seg|Rest], N, Steps) :-
	plan_segment(Seg, SegSteps),
	shift_priorities(SegSteps, N, Shifted),
	N1 is N + 1000,
	plan_segments(Rest, N1, More),
	append(Shifted, More, Steps).

plan(Command, Steps) :-
	split_segments(Command, Segs),
	plan_segments(Segs, 0, Steps).

plan_excluding(Command, Excluded, Steps) :-
	split_segments(Command, Segs),
	plan_excluding_segments(Segs, 0, Excluded, Steps).

plan_excluding_segments([], _N, _Excluded, []).
plan_excluding_segments([Seg|Rest], N, Excluded, Steps) :-
	findall(step(P, intent(T, A)), (intent(Seg, P, T, A), \\+ member(T, Excluded)), Raw),
	shift_priorities(Raw, N, Shifted),
	N1 is N + 1000,
	plan_excluding_segments(Rest, N1, Excluded, More),
	append(Shifted, More, Steps).

% ------------------------------------------------------------------
% intent rules — priority = cross-rule ordering; cut = first match
% ------------------------------------------------------------------
intent(Command, 5, open_google_account, [account(Name)]) :-
	\\+(list_windows_pattern(Command)),
	google_account_name(Command, Name), !.

intent(Command, 10, open_application, [application(App)]) :-
	\\+(list_windows_pattern(Command)),
	\\+ google_account_present(Command),
	split_open(Command, Target),
	compound_split(Target, AppPhrase, _Verb, _Rest),
	pick_app(AppPhrase, App).

intent(Command, 11, write_file, [path(Path), content(Content)]) :-
	compound_write(Command, Path, Content).

intent(Command, 20, Tool, Args) :-
	generic_open(Command, Tool, Args), !.

intent(Command, 30, search_web, [query(Query)]) :-
	\\+(has_open_launch(Command)),
	\\+(contains(Command, 'file')),
	\\+(contains(Command, 'folder')),
	\\+(contains(Command, 'document')),
	\\+ ui_set_into(Command, _, _),
	\\+ ui_set_fill(Command, _, _),
	search_query(Command, Query), !.

intent(Command, 40, system_info, []) :-
	\\+(has_open_launch(Command)),
	( system_kw(W), contains(Command, W) ; how_doing(Command) ), !.

intent(Command, 45, system_info, []) :-
	\\+(has_open_launch(Command)),
	computer_name_q(Command), !.

intent(Command, 50, list_windows, []) :-
	list_windows_pattern(Command), !.

intent(Command, 60, take_screenshot, []) :-
	( contains(Command, 'screenshot') ; contains(Command, 'capture the screen') ), !.

intent(Command, 70, run_command, [command('npm run check && npm test -- --run'), timeout(180000)]) :-
	tests_pattern(Command), !.

intent(Command, 80, read_file, [path(Path)]) :-
	\\+(contains(Command, 'open')),
	\\+(contains(Command, 'clipboard')),
	read_path(Command, Path),
	\\+ is_url(Path), !.
intent(Command, 90, write_file, [path(Path), content(Content)]) :-
	\\+(open_compound(Command)),
	generic_write(Command, Clause),
	parse_write(Clause, Path, Content), !.

intent(Command, 100, run_command, [command(Cmd)]) :-
	run_capture(Command, Cmd),
	\\+(contains(Cmd, 'tests')),
	\\+(contains(Cmd, 'check')),
	\\+(contains(Command, 'test')), !.

intent(Command, 110, kill_process, [target(Target)]) :-
	anchored_verb('kill', Command, Target), !.

intent(Command, 110, kill_process, [target(Target)]) :-
	close_verb(V),
	anchored_verb(V, Command, Target),
	( numeric(Target) ; contains(Target, 'process') ), !.

intent(Command, 110, close_window, [target(Target)]) :-
	close_verb(V),
	anchored_verb(V, Command, Target),
	\\+(numeric(Target)),
	\\+(contains(Target, 'process')), !.

intent(Command, 120, set_volume, [percent(P)]) :-
	volume_set(Command, Digits),
	to_num(Digits, P), !.

intent(Command, 120, adjust_volume, [delta(Delta)]) :-
	volume_delta(Command, Direction, DigitsAtom),
	( DigitsAtom = '' -> Num = 10 ; to_num(DigitsAtom, Num) ),
	( Direction = up -> Delta = Num ; Delta is 0 - Num ), !.

intent(Command, 120, media_control, [action('mute')]) :-
	word_occ2(Command, 'mute', _), !.

intent(Command, 125, media_play, [query(Q)]) :-
	media_verb(V),
	word_occ2(Command, V, _),
	\\+(media_control_word(Command, _)),
	media_query(Command, Q), !.

% Control verbs (next/skip/previous/prev/pause/resume) always map to a media
% control action, even when a target word follows ("play next track").
intent(Command, 130, media_control, [action(Action)]) :-
	media_control_word(Command, Action), !.

% play/pause/resume with a generic media target but no specific song/artist
% ("play music", "pause the music") toggles playback.
intent(Command, 130, media_control, [action(Action)]) :-
	media_verb(V),
	word_occ2(Command, V, _),
	\\+(media_control_word(Command, _)),
	media_target(Command),
	\\+(media_query(Command, _)),
	action_for(V, Action), !.

intent(Command, 140, copy_file, [source(Src), destination(Dst)]) :-
	\\+(contains(Command, 'clipboard')),
	copy_file_split(Command, Src, Dst), !.

intent(Command, 140, clipboard_write, [text(Text)]) :-
	clipboard_write_ok(Command, Text), !.

intent(Command, 140, clipboard_read, []) :-
	clipboard_readish(Command), !.

intent(Command, 150, focus_window, [target(Target)]) :-
	\\+(contains(Command, 'open')),
	focus_verb(V),
	word_occ(Command, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	\\+(R1 = ''),
	Target = R1, !.

intent(Command, 160, mouse_move, [x(X), y(Y)]) :-
	mouse_coords(Command, X, Y), !.

intent(Command, 170, mouse_click, [button('left'), x(X), y(Y), clicks(1)]) :-
	click_coords(Command, X, Y), !.

intent(Command, 180, type_text, [text(Text)]) :-
	\\+ word_occ2(Command, 'file', _),
	\\+ contains(Command, 'into'),
	\\+ ui_set_into(Command, _, _),
	\\+ ui_set_fill(Command, _, _),
	type_capture(Command, Text), !.

intent(Command, 190, lock_screen, []) :-
	lock_screen_pattern(Command), !.

intent(Command, 200, observe_screen, []) :-
	( contains(Command, 'look at my screen') ; contains(Command, 'see the screen')
	; contains(Command, 'observe') ; contains(Command, 'read the screen') ), !.

intent(Command, 210, ui_list, []) :-
	ui_list_pattern(Command), !.

intent(Command, 220, ui_click, [name(Name)]) :-
	click_quote(Command, Name), !.

intent(Command, 220, ui_click, [name(Name)]) :-
	click_label(Command, Name), !.

intent(Command, 220, ui_click, [name(Name)]) :-
	click_control(Command, Name), !.

intent(Command, 230, search_files, [pattern(Pattern)]) :-
	sf_capture(Command, Pattern), !.

intent(Command, 240, system_power, [action(Action), delay_seconds(5)]) :-
	power_kw(Command),
	target_word(Command),
	power_action(Command, Action), !.

intent(Command, 240, system_power, [action('sleep'), delay_seconds(5)]) :-
	\\+(power_kw(Command)),
	word_occ(Command, 'sleep', _),
	\\+(contains(Command, 'mode')), !.

intent(Command, 250, list_apps, []) :-
	list_apps_pattern(Command), !.

intent(Command, 260, system_services, [action('list')]) :-
	( contains(Command, 'list') ; contains(Command, 'show') ),
	contains(Command, 'services'), !.

intent(Command, 260, system_services, [action(Action), name(Name)]) :-
	svc_verb(V),
	word_occ(Command, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Command, End, _, 0, R0),
	skip_spaces1(R0, R1),
	opt_word('the', R1, R2),
	skip_spaces(R2, R3),
	svc_name(R3, Name),
	Action = V, !.

% ------------------------------------------------------------------
% extended-capability intents — placed before the env-var rules so the
% cuts in the broad env_get/1 clauses cannot prune them (tau-prolog's
% findall backtracks clause-by-clause, and a cut commits to the first
% matching clause in file order).
% ------------------------------------------------------------------
intent(Command, 9, open_path, [path(Path)]) :-
	open_path_lead(Command),
	open_path_capture(Command, Path),
	\\+ compound_split(Command, _, _, _), !.

intent(Command, 46, get_volume, []) :- volume_level_q(Command), !.

intent(Command, 47, get_active_window, []) :- active_window_q(Command), !.

intent(Command, 51, list_processes, [filter(Filter)]) :-
	list_processes_pattern(Command),
	process_filter(Command, Filter), !.
intent(Command, 51, list_processes, []) :- list_processes_pattern(Command), !.

intent(Command, 52, list_dir, [path(Path)]) :-
	dir_list_pattern(Command),
	dir_list_capture(Command, Path), !.

intent(Command, 62, remember, [content(Content)]) :-
	remember_capture(Command, Content),
	\\+ recall_query(Command, _), !.

intent(Command, 63, recall, [query(Query)]) :-
	recall_query(Command, Query), !.

intent(Command, 81, read_page, [url(Url)]) :-
	read_page_intent(Command),
	read_page_url(Command, Url),
	\\+ contains(Command, 'open'), !.

intent(Command, 112, minimize_window, [target(Target)]) :-
	minimize_verb(V),
	anchored_verb(V, Command, Target), !.

intent(Command, 122, show_notification, [title(Title), message(Message)]) :-
	notify_capture(Command, Title, Message), !.

intent(Command, 141, move_file, [source(Src), destination(Dst)]) :-
	\\+ contains(Command, 'clipboard'),
	move_file_split(Command, Src, Dst), !.

intent(Command, 142, zip_folder, [source(Src), archive(Arc)]) :-
	zip_capture(Command, Src, Arc), !.

intent(Command, 145, delete_file, [path(Path)]) :-
	delete_capture(Command, Path),
	( word_occ2(Command, 'file', _) ; word_occ2(Command, 'folder', _) ; looks_like_path(Path) ), !.

intent(Command, 155, press_key, [combo(Combo)]) :-
	press_key_capture(Command, Combo),
	\\+ word_occ2(Command, 'file', _), !.

intent(Command, 175, scroll_wheel, [direction(Direction), clicks(Notches)]) :-
	scroll_capture(Command, Direction, Notches), !.

intent(Command, 225, ui_set_text, [name(Name), text(Text)]) :-
	( ui_set_into(Command, Text, Name) ; ui_set_fill(Command, Name, Text) ),
	\\+ env_set(Command, _, _),
	\\+ word_occ2(Command, 'file', _), !.

intent(Command, 270, set_env_var, [name(Name), value(Value)]) :-
	env_set(Command, Name, Value), !.

intent(Command, 270, get_env_var, [name(Name)]) :-
	\\+(computer_name_q(Command)),
	env_get(Command, Name), !.
`;
