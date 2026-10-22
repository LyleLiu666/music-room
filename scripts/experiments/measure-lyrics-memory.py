"""Run the unchanged production worker and expose diagnostic counters, not summed usage."""
import importlib.util,json,pathlib,sys,threading,time,os

worker_path,task_path=sys.argv[1:]
spec=importlib.util.spec_from_file_location('lyrics_worker',worker_path)
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
task=json.loads(pathlib.Path(task_path).read_text())
stop=threading.Event()

def sample():
    while not stop.wait(.1):
        torch=sys.modules.get('torch');psutil=sys.modules.get('psutil')
        if torch is None or psutil is None:continue
        try:
            print(json.dumps({'measurement':{'rss':psutil.Process().memory_info().rss,
                'metalDriver':torch.mps.driver_allocated_memory(),
                'metalActive':torch.mps.current_allocated_memory()}}),flush=True)
        except (AttributeError,RuntimeError):pass

threading.Thread(target=sample,daemon=True).start()
try:worker.run(task)
finally:stop.set()
