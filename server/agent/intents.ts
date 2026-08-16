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

pick_app(Target, App) :-
	findall(K, (app_keyword(K), contains(Target, K)), Kws),
	( Kws = [] -> App = Target ; longest_kw(Kws, App) ).
longest_kw([K], K).
longest_kw([K|Ks], Best) :-
	longest_kw(Ks, B),
	atom_length(K, LK),
	atom_length(B, LB),
	( LK > LB -> Best = K ; Best = B ).

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

list_windows_pattern(Text) :-
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
	skip_spaces1(Tail, T0),
	atom_concat('to', T1, T0),
	skip_spaces1(T1, T2),
	path_run(T2, Dst, _).

copy_capture(Text, Out) :-
	member(V, ['copy', 'clipboard']),
	word_occ(Text, V, Before),
	atom_length(V, VL),
	End is Before + VL,
	sub_atom(Text, End, _, 0, R0),
	skip_spaces1(R0, R1),
	\\+(R1 = ''),
	Out = R1.

clipboard_readish(Text) :-
	( word_occ(Text, 'clipboard', Before),
	  atom_length('clipboard', VL), End is Before + VL,
	  sub_atom(Text, End, _, 0, R0), skip_spaces(R0, R1),
	  ( atom_concat('read', _, R1) ; atom_concat('show', _, R1) ) )
	; ( contains(Text, 'what'), contains(Text, 'clipboard') ).

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
	member(F, ['file', 'folder', 'document']),
	word_prefix(R5, F),
	atom_concat(F, R6, R5),
	skip_spaces1(R6, R7),
	\\+(R7 = ''),
	Pattern = R7.

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
% intent rules — priority = cross-rule ordering; cut = first match
% ------------------------------------------------------------------
intent(Command, 10, open_application, [application(App)]) :-
	split_open(Command, Target),
	compound_split(Target, AppPhrase, _Verb, _Rest),
	pick_app(AppPhrase, App).

intent(Command, 11, write_file, [path(Path), content(Content)]) :-
	compound_write(Command, Path, Content).

intent(Command, 20, Tool, Args) :-
	generic_open(Command, Tool, Args), !.

intent(Command, 30, search_web, [query(Query)]) :-
	\\+(has_open_launch(Command)),
	search_query(Command, Query), !.

intent(Command, 40, system_info, []) :-
	\\+(has_open_launch(Command)),
	( system_kw(W), contains(Command, W) ; how_doing(Command) ), !.

intent(Command, 50, list_windows, []) :-
	list_windows_pattern(Command), !.

intent(Command, 60, take_screenshot, []) :-
	( contains(Command, 'screenshot') ; contains(Command, 'capture the screen') ), !.

intent(Command, 70, run_command, [command('npm run check && npm test -- --run'), timeout(180000)]) :-
	tests_pattern(Command), !.

intent(Command, 80, read_file, [path(Path)]) :-
	\\+(contains(Command, 'open')),
	read_path(Command, Path), !.

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

intent(Command, 130, media_control, [action(Action)]) :-
	media_verb(V),
	word_occ2(Command, V, _),
	media_target(Command),
	action_for(V, Action), !.

intent(Command, 140, copy_file, [source(Src), destination(Dst)]) :-
	\\+(contains(Command, 'clipboard')),
	copy_file_split(Command, Src, Dst), !.

intent(Command, 140, clipboard_write, [text(Text)]) :-
	\\+(copy_file_split(Command, _, _)),
	\\+(clipboard_readish(Command)),
	copy_capture(Command, Text), !.

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
	\\+(contains(Command, 'file')),
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

intent(Command, 270, set_env_var, [name(Name), value(Value)]) :-
	env_set(Command, Name, Value), !.

intent(Command, 270, get_env_var, [name(Name)]) :-
	env_get(Command, Name), !.

plan(Command, Steps) :-
	findall(step(P, intent(T, A)), intent(Command, P, T, A), Raw),
	( Raw = [] -> Steps = [step(999, intent(chat, [message(Command)]))] ; Steps = Raw ).
`;