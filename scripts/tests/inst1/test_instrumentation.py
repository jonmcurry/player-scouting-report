"""Synthetic-only instrumentation tests. No downloads, model inference or cloud."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
ENGINE = ROOT / "scripts/pose3d"
sys.path.insert(0, str(ENGINE))
from instrumentation import inst1
import locate_swing
import decimate


def ffmpeg(*args):
    result = subprocess.run(["ffmpeg", "-v", "error", "-y", *map(str,args)], capture_output=True)
    if result.returncode:
        raise AssertionError(result.stderr.decode(errors="replace"))


def fixture(path, count=24, fps=30, jitter=False):
    """Independent identity oracle: visible number + 16 binary burn-in cells.

    Frame content is authored before encoding. Mapping code cannot see or parse
    the cells. The oracle reads them directly from independently decoded video.
    """
    args = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-s", "160x96", "-r", str(fps), "-i", "pipe:0"]
    if jitter:
        args += ["-vf", "settb=1/90000,setpts=N*3000+mod(N\\,3)*400", "-fps_mode", "passthrough", "-enc_time_base", "1/90000"]
    args += ["-c:v", "libx264", "-crf", "0", "-pix_fmt", "yuv420p", str(path)]
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for i in range(count):
            rng = np.random.default_rng(i + 1729)
            # Broad random tiles remain distinctive after re-encoding/downsampling.
            frame = cv2.resize(rng.integers(25,230,(12,20,3),dtype=np.uint8),(160,96),interpolation=cv2.INTER_NEAREST)
            for bit in range(16):
                frame[:12,bit*10:(bit+1)*10] = 255 if i & (1 << bit) else 0
            cv2.putText(frame, str(i), (4,35), cv2.FONT_HERSHEY_SIMPLEX, .6, (255,255,255),1)
            process.stdin.write(frame.tobytes())
        process.stdin.close()
        error = process.stderr.read()
        if process.wait() != 0:
            raise AssertionError(error.decode(errors="replace"))
    finally:
        process.stderr.close()
        if process.poll() is None:
            process.kill()
            process.wait()


def decode(path, unrotate=False):
    cap = cv2.VideoCapture(str(path))
    frames, ids = [], []
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(inst1.signature(frame))
            oracle = cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE) if unrotate else frame
            ids.append(sum(1 << bit for bit in range(16) if oracle[5,bit*10+5].mean()>127))
    finally:
        cap.release()
    return frames, ids


class IdentityVideos(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)

    def verify(self, raw, analysis=None, intermediate=None, unrotate=False):
        analysis = analysis or raw
        intermediate = intermediate or raw
        observed, ids = decode(analysis, unrotate)
        raw_inv, mid_inv, analyzed = map(inst1.inventory, (raw, intermediate, analysis))
        result = inst1.build_map(raw_inv, mid_inv, analyzed, observed, observed, {})
        self.assertTrue(result["verified"], result["reasons"])
        self.assertEqual([r["raw_frame"] for r in result["frames"]], ids)
        self.assertEqual([r["raw_pts"] for r in result["frames"]], [raw_inv["pts"][i] for i in ids])
        return result, analyzed

    def test_cfr_30(self):
        raw=self.dir/'cfr.mp4'; fixture(raw)
        result, inv = self.verify(raw)
        self.assertEqual(len(result['frames']),24)
        self.assertLess(inst1.timing(inv,30)['max_pts_index_deviation_s'],1e-12)

    def test_vfr_jitter(self):
        raw=self.dir/'vfr.mp4'; fixture(raw,jitter=True)
        _, inv=self.verify(raw)
        for i, pts in enumerate(inv['pts']):
            expected=inst1.Fraction(i,30)+inst1.Fraction((i%3)*400,90000)
            self.assertEqual(pts*inst1.Fraction(inv['time_base']),expected)
        self.assertGreater(inst1.timing(inv,30)['max_delta_s']-inst1.timing(inv,30)['min_delta_s'], .001)
        self.assertGreater(inst1.timing(inv,30)['max_pts_index_deviation_s'], .001)

    def test_high_rate_real_decimator(self):
        raw=self.dir/'hfr.mp4'; fixture(raw,120,240)
        result=decimate.run(raw,self.dir)
        if not result['decimated']:
            # FFmpeg 9 removed -vsync. Preserve and explicitly test the baseline
            # fallback; the separately authored fixture below tests successful
            # decimation identity, not a silently repaired production decimator.
            self.assertEqual(result['reason'],'ffmpeg decimation failed')
            self.assertEqual(Path(result['video_path_for_pipeline']),raw)
            self.verify(raw)
        selected=self.dir/'selected.mp4'
        ffmpeg('-i',raw,'-vf',"select='not(mod(n,8))'",'-fps_mode','vfr','-c:v','libx264','-crf','18',selected)
        mapping,_=self.verify(raw,selected)
        self.assertGreater(mapping['frames'][1]['raw_frame']-mapping['frames'][0]['raw_frame'],1)

    def test_long_clip_forces_real_audio_trim(self):
        raw=self.dir/'long.mp4'; fixture(raw,1950)
        audio=self.dir/'audio.mp4'
        ffmpeg('-i',raw,'-f','lavfi','-i',
               'aevalsrc=if(between(t\\,30\\,30.04)\\,0.8*sin(2*PI*3000*t)\\,0):s=16000:d=65',
               '-c:v','copy','-c:a','aac',audio)
        result=locate_swing.run(audio,self.dir)
        self.assertTrue(result['trimmed'],result['reason'])
        mapping,_=self.verify(audio,Path(result['video_path_for_pipeline']))
        self.assertGreater(mapping['frames'][0]['raw_frame'],0)

    def test_combined_trim_decimation(self):
        raw=self.dir/'combined.mp4'; fixture(raw,480,240)
        mid=self.dir/'trim.mp4'
        self.assertTrue(locate_swing.trim_video(raw,.5,1,mid))
        result=decimate.run(mid,self.dir)
        if not result['decimated']:
            self.assertEqual(Path(result['video_path_for_pipeline']),mid)
        selected=self.dir/'selected.mp4'
        ffmpeg('-i',mid,'-vf',"select='not(mod(n,8))'",'-fps_mode','vfr','-c:v','libx264','-crf','18',selected)
        self.verify(raw,selected,mid)

    def test_missing_frames_recovered_by_content_not_formula(self):
        raw=self.dir/'raw.mp4'; fixture(raw)
        dropped=self.dir/'drop.mp4'
        ffmpeg('-i',raw,'-vf',"select='not(eq(n,5)+eq(n,9))'",'-fps_mode','vfr','-c:v','libx264','-crf','18',dropped)
        result,_=self.verify(raw,dropped)
        self.assertNotIn(5,[r['raw_frame'] for r in result['frames']])

    def test_duplicated_content_is_ambiguous(self):
        raw=self.dir/'raw.mp4'; fixture(raw)
        duplicate=self.dir/'duplicate.mp4'
        ffmpeg('-i',raw,'-vf','loop=loop=1:size=1:start=4','-c:v','libx264','-crf','18',duplicate)
        inv=inst1.inventory(duplicate);obs,_=decode(duplicate)
        result=inst1.build_map(inv,inv,inv,obs,obs,{})
        self.assertFalse(result['verified'])
        self.assertIn('CONTENT_AMBIGUOUS',result['reasons'])

    def test_rebased_trim_timestamps(self):
        raw=self.dir/'raw.mp4';fixture(raw,90)
        trim=self.dir/'trim.mp4';self.assertTrue(locate_swing.trim_video(raw,1,1,trim))
        result,inv=self.verify(raw,trim)
        self.assertGreater(result['frames'][0]['raw_pts_s'], float(inv['pts'][0])*float(inst1.Fraction(inv['time_base'])))

    def test_rotation_metadata(self):
        raw=self.dir/'raw.mp4';fixture(raw)
        rotated=self.dir/'rotated.mp4'
        ffmpeg('-display_rotation','90','-i',raw,'-c','copy',rotated)
        self.assertEqual(inst1.inventory(rotated)['rotation_degrees'],90)
        self.verify(rotated,unrotate=True)

    def test_model_decoder_mismatch(self):
        raw=self.dir/'raw.mp4';fixture(raw)
        inv=inst1.inventory(raw);obs,_=decode(raw)
        result=inst1.build_map(inv,inv,inv,obs,obs[:-1],{})
        self.assertFalse(result['verified'])
        self.assertIn('DECODER_COUNT_DISAGREEMENT',result['reasons'])
        self.assertTrue(all(r['raw_frame'] is None for r in result['frames']))


class FailClosed(unittest.TestCase):
    def test_pts_parser_never_invents_or_truncates_values(self):
        for value in (None,'N/A'):
            self.assertIsNone(inst1.presentation_timestamp(value))
        for value in (True,1.2,'private/path','NaN','1.5'):
            with self.assertRaisesRegex(ValueError,'INVALID_PTS'):
                inst1.presentation_timestamp(value)
        self.assertEqual(inst1.presentation_timestamp('-120'),-120)
        self.assertEqual(inst1.presentation_timestamp(0),0)

    def test_legacy_rotation_tags_require_verified_orientation(self):
        self.assertEqual(inst1.display_rotation({}),0)
        self.assertEqual(inst1.display_rotation({'tags':{'rotate':'0'}}),0)
        with self.assertRaisesRegex(ValueError,'LEGACY_ROTATION_TAG_UNVERIFIED'):
            inst1.display_rotation({'tags':{'rotate':'90'}})
        self.assertEqual(inst1.display_rotation({'side_data_list':[{'rotation':90}]}),90)
        with self.assertRaisesRegex(ValueError,'UNSUPPORTED_ROTATION'):
            inst1.display_rotation({'side_data_list':[{'rotation':float('nan')}]})

    def inventory(self):
        return {'pts':[0,1,2], 'time_base':'1/30','nominal_fps':30,'rotation_degrees':0,
                'signatures':[np.full(1024,i*80,np.uint8) for i in range(3)]}

    def test_missing_and_duplicate_pts(self):
        for pts in ([0,None,2],[0,0,2],[2,1,0]):
            inv=self.inventory();inv['pts']=pts;obs=inv['signatures']
            self.assertFalse(inst1.build_map(inv,inv,inv,obs,obs,{})['verified'])

    def test_corrupted_content_and_reordered_same_count(self):
        inv=self.inventory();obs=inv['signatures']
        for changed in ([obs[1],obs[0],obs[2]], [np.full(1024,255,np.uint8),*obs[1:]]):
            self.assertFalse(inst1.build_map(inv,inv,inv,obs,changed,{})['verified'])

    def test_empty_and_budget_limits(self):
        inv=self.inventory()
        self.assertFalse(inst1.build_map(inv,inv,inv,[],[],{})['verified'])
        with patch.object(inst1,'MAX_PAIRS',1):
            self.assertEqual(inst1.matches(inv['signatures'],inv['signatures'])[0][2],'MATCH_BUDGET_EXCEEDED')

    def test_tolerance_boundary_and_ambiguity(self):
        zero=np.zeros(1024,np.uint8)
        self.assertEqual(inst1.matches([zero],[zero+4])[0][0],0)
        self.assertIsNone(inst1.matches([zero],[zero+5])[0][0])
        self.assertIsNone(inst1.matches([zero],[zero,zero+1])[0][0])

    def test_observer_does_not_mutate_input(self):
        frame=np.arange(96*160*3,dtype=np.uint8).reshape(96,160,3)
        original=frame.copy();inst1.signature(frame)
        np.testing.assert_array_equal(frame,original)

    def test_failures_record_safe_codes_without_changing_control_flow(self):
        with tempfile.TemporaryDirectory() as d:
            session=inst1.Session(Path(d)/'PRIVATE-NAME.mp4',Path(d))
            with patch.object(inst1,'_session',session), patch.object(session,'finish',side_effect=OSError('SECRET /private/path')):
                inst1.call('finish')
            text=(Path(d)/'engine_manifest.json').read_text()
            self.assertNotIn('SECRET',text); self.assertNotIn('PRIVATE',text)
            self.assertEqual(json.loads(text)['reasons'],['INSTRUMENTATION_FINISH_FAILED'])

    def test_capture_snapshot_matches_pr5(self):
        for name in ('models.lock.json','requirements.lock.txt','capture_environment_v1.py'):
            source='capture_environment.py' if name.endswith('.py') else name
            self.assertEqual((ENGINE/'instrumentation'/name).read_text(),(ROOT/'src/eval/environment'/source).read_text())

    def test_lifecycle_attempts_artifact_binding_and_privacy(self):
        inv=self.inventory()
        with tempfile.TemporaryDirectory() as d:
            out=Path(d);raw=out/'private-athlete-name.bin';raw.write_bytes(b'synthetic')
            s=inst1.Session(raw,out)
            def fake_command(args,cwd=None):
                if args[:2]==['git','rev-parse']:return b'a'*40
                if args[0]=='git':return b''
                if args[0]=='node':return b'Baseline verified'
                return json.dumps({'environment_version':inst1.EXPECTED_ENVIRONMENT,
                    'model_integrity':{'synthetic':{'status':'verified'}},'provenance_reasons':[]}).encode()
            with patch.object(inst1,'command',side_effect=fake_command),patch.object(inst1,'inventory',return_value=inv):
                s.begin()
                self.assertFalse(json.loads((out/'frame_map.json').read_text())['verified'])
                for number in (1,2):
                    s.start_attempt(raw,raw,{'trim_start_s':0},{'decimated':False},number)
                    for kind in ('pose','bat'):
                        for i in range(3):s.observe(kind,np.full((96,160,3),i*80,np.uint8))
                    s.attempt['fps']=30
                    s.end_attempt()
                s.finish()
            manifest=json.loads((out/'engine_manifest.json').read_text())
            mapping=json.loads((out/'frame_map.json').read_text())
            self.assertEqual(manifest['status'],'verified')
            self.assertEqual(manifest['pose_decoded_frames'],3)
            self.assertEqual(manifest['frame_map_sha256'],inst1.digest(out/'frame_map.json'))
            self.assertEqual(manifest['run_id'],mapping['run_id'])
            self.assertEqual([r['attempt_number'] for r in mapping['attempt_history']],[1,2])
            self.assertTrue(mapping['verified'])
            self.assertNotIn('private-athlete',json.dumps([manifest,mapping]))
            self.assertNotIn(str(out),json.dumps([manifest,mapping]))

    def test_missing_observation_keeps_analyzed_row_count(self):
        inv=self.inventory()
        with tempfile.TemporaryDirectory() as d:
            raw=Path(d)/'source';raw.write_bytes(b'synthetic')
            s=inst1.Session(raw,Path(d));s.raw=inv;s.manifest['input_sha256']=inst1.digest(raw)
            s.start_attempt(raw,raw,{}, {},1)
            for kind in ('pose','bat'):
                for frame in (np.zeros((16,16,3),np.uint8),None,np.full((16,16,3),160,np.uint8)):
                    s.observe(kind,frame)
            with patch.object(inst1,'inventory',return_value=inv):s.finish()
            self.assertEqual(len(s.frame_map['frames']),3)
            self.assertTrue(all(r['status']=='unmappable' for r in s.frame_map['frames']))

    def test_existing_temp_target_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d);target=out/'engine_manifest.json.inst1-tmp';target.write_bytes(b'preserve')
            with self.assertRaises(OSError):inst1.atomic_json(out,'engine_manifest.json',{})
            self.assertEqual(target.read_bytes(),b'preserve')

    def test_malformed_transform_cannot_leak_a_path(self):
        with tempfile.TemporaryDirectory() as d:
            s=inst1.Session(Path(d)/'input',Path(d))
            with patch.object(inst1,'_session',s):
                inst1.call('start_attempt',s.video,s.video,{'trim_start_s':'SECRET/private'}, {},1)
            self.assertNotIn('SECRET',(Path(d)/'frame_map.json').read_text())
            self.assertIn('INVALID_TRANSFORM_METADATA',s.errors)


HOOKS = {
 'run_pipeline.py': ['from instrumentation import inst1', 'inst1.call("finish")',
    'inst1.call("end_attempt")', 'inst1.call("end_attempt")',
    'inst1.call("begin", video_path, out_dir)',
    'inst1.call("start_attempt", stage0_5["original_video_path"], analysis_video_path, candidate, stage0_5, attempt_i + 1)'],
 'detect_2d.py': ['from instrumentation import inst1', 'inst1.call("fps", fps)',
    'inst1.call("observe", "pose", getattr(r, "orig_img", None))',
    'inst1.call("observe", "bat", getattr(r, "orig_img", None))'],
}


def stripped(source, name):
    expected=[ast.dump(ast.parse(s).body[0]) for s in HOOKS[name]]
    found=[]
    class Strip(ast.NodeTransformer):
        def visit(self,node):
            if ast.dump(node) in expected:
                found.append(ast.dump(node));return None
            return super().visit(node)
    tree=Strip().visit(ast.parse(source))
    if sorted(found)!=sorted(expected):
        raise AssertionError('Missing, duplicated or changed observer hook')
    return ast.dump(tree)


class AlgorithmPreservation(unittest.TestCase):
    def test_detector_outputs_identical_with_synthetic_model_results(self):
        # Execute original tagged detector source and current source with the same
        # deterministic model doubles. This is integration evidence, not empirical
        # GPU/real-video equivalence or a model accuracy test.
        baseline=subprocess.check_output(['git','--no-replace-objects','show',
            'f79b09e63092e87efd1250c3b263d29086d81a79:scripts/pose3d/detect_2d.py'],cwd=ROOT).decode()
        class Tensor:
            def __init__(self,data): self.data=np.asarray(data)
            def cpu(self): return self
            def numpy(self): return self.data
        class Boxes:
            xyxy=Tensor([[90,30,130,50]]); conf=Tensor([.9]); id=None
            def __len__(self): return 1
        class Model:
            def __init__(self,*args): pass
            def predict(self,source,**kwargs):
                cap=cv2.VideoCapture(source)
                try:
                    i=0
                    while True:
                        ok,frame=cap.read()
                        if not ok: break
                        kps=[[[35+j*4+i*.1,25+(j%5)*10] for j in range(17)]]
                        yield types.SimpleNamespace(orig_img=frame, keypoints=types.SimpleNamespace(
                            xy=Tensor(kps),conf=Tensor([[.9]*17])),boxes=Boxes())
                        i+=1
                finally: cap.release()
            track=predict
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);raw=root/'source.mp4';fixture(raw,24)
            session=inst1.Session(raw,root)
            session.start_attempt(raw,raw,{'trim_start_s':0,'trim_end_s':None},{'decimated':False},1)
            outputs=[]
            for index,source in enumerate((baseline,(ENGINE/'detect_2d.py').read_text())):
                module=types.ModuleType('synthetic_detector_'+str(index))
                module.__file__=str(ENGINE/'detect_2d.py')
                with patch.dict(sys.modules,{'ultralytics':types.SimpleNamespace(YOLO=Model)}):
                    exec(compile(source,module.__file__,'exec'),module.__dict__)
                module._cuda_available=lambda:False
                module.POSE_MODEL=module.DET_MODEL=raw
                out=root/str(index)
                with patch.object(inst1,'_session',session):
                    module.run(raw,out)
                outputs.append([(out/name).read_bytes() for name in ('pose_2d.json','bat_path.json')])
            self.assertEqual(outputs[0],outputs[1])
            self.assertEqual(session.attempt['counts'],{'pose':24,'bat':24})
            inv=inst1.inventory(raw)
            mapping=inst1.build_map(inv,inv,inv,session.attempt['pose'],session.attempt['bat'],{})
            self.assertTrue(mapping['verified'],mapping['reasons'])

    def test_removing_exact_observer_statements_recovers_original_ast(self):
        for name in HOOKS:
            baseline=subprocess.check_output(['git','--no-replace-objects','show',
                'f79b09e63092e87efd1250c3b263d29086d81a79:scripts/pose3d/'+name],cwd=ROOT).decode()
            current=(ENGINE/name).read_text()
            self.assertEqual(stripped(current,name),ast.dump(ast.parse(baseline)))
            if name=='detect_2d.py':
                changed=current.replace('BATCH_SIZE = 16','BATCH_SIZE = 17')
                self.assertNotEqual(stripped(changed,name),ast.dump(ast.parse(baseline)))
            with self.assertRaises(AssertionError):
                stripped(current.replace('inst1.call(', 'inst1.other('),name)


if __name__=='__main__':
    unittest.main()
