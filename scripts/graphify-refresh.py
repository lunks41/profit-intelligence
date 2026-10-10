"""Refresh graphify-out after changing code (no LLM needed).

    pnpm graph:refresh

Re-extracts only the code files that changed since the last refresh (AST), replaces their nodes in
graphify-out/graph.json, re-clusters, and rewrites GRAPH_REPORT.md, graph.json and graph.html.
Changed docs are not re-extracted (that needs the /graphify skill with semantic agents); the script
says how many were skipped. Run it from the project folder, after finishing a piece of work.
"""
import json
import sys
from pathlib import Path


def main():
    from graphify.analyze import god_nodes, suggest_questions, surprising_connections
    from graphify.build import build_from_json
    from graphify.cluster import cluster, score_all
    from graphify.detect import detect, detect_incremental, save_manifest
    from graphify.export import to_html, to_json
    from graphify.extract import collect_files, extract
    from graphify.report import generate
    from networkx.readwrite import json_graph

    root = Path('.').resolve()
    graph_path = Path('graphify-out/graph.json')
    if not graph_path.exists():
        sys.exit('No graph yet. Run /graphify . once to build it, then use this script.')

    inc = detect_incremental(Path('.'))
    code = inc['new_files'].get('code', [])
    docs = len(inc['new_files'].get('document', []))
    if not code:
        print(f'No code files changed ({docs} doc(s) changed, not re-extracted).')
        return

    def rel(f):
        return Path(f).resolve().relative_to(root).as_posix()

    files = []
    for f in code:
        p = Path(f)
        files.extend(collect_files(p) if p.is_dir() else [p])
    ast = extract(files)
    for item in ast['nodes'] + ast['edges']:
        if item.get('source_file'):
            item['source_file'] = item['source_file'].replace('\\', '/')

    G = json_graph.node_link_graph(json.loads(graph_path.read_text(encoding='utf8')), edges='links')
    changed = {rel(f) for f in code}
    G.remove_nodes_from([n for n, d in G.nodes(data=True) if d.get('source_file') in changed])
    G.update(build_from_json(ast))

    communities = cluster(G)
    cohesion = score_all(G, communities)
    labels = {c: 'Community ' + str(c) for c in communities}
    report = generate(
        G, communities, cohesion, labels, god_nodes(G), surprising_connections(G, communities),
        detect(Path('.')), {'input': 0, 'output': 0}, '.',
        suggested_questions=suggest_questions(G, communities, labels),
    )
    Path('graphify-out/GRAPH_REPORT.md').write_text(report, encoding='utf8')
    to_json(G, communities, str(graph_path))
    to_html(G, communities, 'graphify-out/graph.html', community_labels=labels)
    save_manifest(inc['files'])
    print(
        f'graph refreshed: {len(code)} code file(s) re-read, {G.number_of_nodes()} nodes, '
        f'{G.number_of_edges()} edges, {len(communities)} communities'
        + (f'; {docs} changed doc(s) not re-extracted' if docs else '')
    )


# the guard matters on Windows: graphify extracts files in worker processes
if __name__ == '__main__':
    main()
