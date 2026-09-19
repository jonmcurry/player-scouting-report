"""Build private visual QA artifacts and an honest diagnostics contract from pipeline output."""
import cv2, json, math, pathlib, shutil, sys
import numpy as np

COCO_BONES=[(5,6),(5,7),(7,9),(6,8),(8,10),(5,11),(6,12),(11,12),(11,13),(13,15),(12,14),(14,16)]
H36M_BONES=[(0,1),(1,2),(2,3),(0,4),(4,5),(5,6),(0,7),(7,8),(8,9),(9,10),(7,11),(11,12),(12,13),(7,14),(14,15),(15,16)]
STABLE_BONES=[(11,12),(12,13),(14,15),(15,16),(1,2),(2,3),(4,5),(5,6),(11,14),(1,4)]

def load(p): return json.loads(pathlib.Path(p).read_text())
def dump(p,v): pathlib.Path(p).write_text(json.dumps(v,indent=2))
def mean(xs): return sum(xs)/len(xs) if xs else 0.0
def coverage(frames,pred): return sum(1 for f in frames if pred(f))/max(1,len(frames))
def dist(a,b): return math.dist(a,b)
def coeff_var(xs):
    m=mean(xs); return float(np.std(xs)/m) if m else 0.0
def bone_variance(frames): return mean([coeff_var([dist(f['joints'][a],f['joints'][b]) for f in frames if f.get('tracked')]) for a,b in STABLE_BONES])
def rigidify(frames):
    targets={(a,b):float(np.median([dist(f['joints'][a],f['joints'][b]) for f in frames if f.get('tracked')])) for a,b in H36M_BONES}
    out=[]; last={}
    for f in frames:
        joints=[np.array(p,float) for p in f['joints']]
        fixed=[p.copy() for p in joints]
        for a,b in H36M_BONES:
            v=joints[b]-joints[a]; n=np.linalg.norm(v); u=v/n if n>1e-8 else last.get((a,b),np.array([0,-1,0.])); last[(a,b)]=u
            fixed[b]=fixed[a]+u*targets[(a,b)]
        out.append({**f,'joints':[[round(float(x),6) for x in p] for p in fixed]})
    return out
def auto_level(frames):
    """One rigid per-clip rotation: early-stance pelvis->thorax becomes vertical."""
    sample=[f for f in frames[:max(1,math.ceil(len(frames)*.2))] if f.get('tracked')]
    if not sample:return frames
    up=np.mean([np.array(f['joints'][7])-((np.array(f['joints'][1])+np.array(f['joints'][4]))/2) for f in sample],axis=0)
    up=up/max(np.linalg.norm(up),1e-9);target=np.array([0.,0.,1.]);v=np.cross(up,target);c=float(np.dot(up,target));s=np.linalg.norm(v)
    if s<1e-8:R=np.eye(3) if c>0 else np.diag([1,-1,-1])
    else:
        vx=np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]])
        R=np.eye(3)+vx+vx@vx*((1-c)/(s*s))
    out=[]
    for f in frames:
        j=(R@np.array(f['joints']).T).T;out.append({**f,'joints':j.round(6).tolist()})
    return out
def root_jitter(frames):
    roots=[np.array(f['joints'][0]) for f in frames if f.get('tracked')]
    if len(roots)<3:return 0
    velocities=np.diff(roots,axis=0); accelerations=np.diff(velocities,axis=0)
    return float(np.median(np.linalg.norm(accelerations,axis=1)))
def foot_slide(frames,idx):
    pts=[np.array(f['joints'][idx]) for f in frames if f.get('tracked')]
    if len(pts)<2:return 0
    speeds=np.linalg.norm(np.diff(pts,axis=0),axis=1); planted=speeds[speeds<=np.percentile(speeds,35)]
    return float(np.mean(planted)) if len(planted) else 0
def lock_foot(frames,idx,threshold=.012,min_run=4):
    out=[{**f,'joints':[list(p) for p in f['joints']]} for f in frames];start=None
    for i in range(1,len(frames)+1):
        slow=i<len(frames) and dist(frames[i]['joints'][idx],frames[i-1]['joints'][idx])<=threshold
        if slow and start is None:start=i-1
        if (not slow or i==len(frames)) and start is not None:
            end=i-1
            if end-start+1>=min_run:
                anchor=np.array(out[start]['joints'][idx])
                for k in range(start,end+1):
                    foot=np.array(out[k]['joints'][idx]);delta=anchor-foot;delta[2]=0
                    out[k]['joints']=(np.array(out[k]['joints'])+delta).round(6).tolist()
            start=None
    return out
def root_jitter_2d(frames,width):
    roots=[]
    for f in frames:
        k=f.get('keypoints') or []
        if len(k)>=13 and k[11][2]>=.25 and k[12][2]>=.25:roots.append(np.mean(np.array([k[11][:2],k[12][:2]]),axis=0)/width)
    return float(np.median(np.linalg.norm(np.diff(np.diff(np.array(roots),axis=0),axis=0),axis=1))) if len(roots)>2 else 0
def bat_discontinuities(frames,w,h):
    pts=[None if not f.get('tip') else np.array(f['tip']) for f in frames]; count=0
    for a,b in zip(pts,pts[1:]):
        if a is not None and b is not None and np.linalg.norm(b-a)>.12*math.hypot(w,h):count+=1
    return count
def draw_pose(img,f):
    pts=f.get('keypoints') or []
    if len(pts) < 17: return
    for a,b in COCO_BONES:
        if pts[a][2]>=.25 and pts[b][2]>=.25: cv2.line(img,tuple(map(int,pts[a][:2])),tuple(map(int,pts[b][:2])),(30,220,80),3)
    good=[p for p in pts if p[2]>=.25]
    for x,y,c in good: cv2.circle(img,(int(x),int(y)),4,(20,245,245),-1)
    if good:
        xs=[p[0] for p in good];ys=[p[1] for p in good];cv2.rectangle(img,(int(min(xs)),int(min(ys))),(int(max(xs)),int(max(ys))),(60,180,255),2)
        cv2.putText(img,f"pose {mean([p[2] for p in good]):.2f}",(int(min(xs)),max(24,int(min(ys))-8)),cv2.FONT_HERSHEY_SIMPLEX,.6,(60,180,255),2)
def draw_bat(img,f):
    if f.get('tip') and f.get('knob'):
        a=tuple(map(int,f['knob']));b=tuple(map(int,f['tip']));cv2.line(img,a,b,(0,120,255),6);cv2.circle(img,b,7,(0,0,255),-1)
        cv2.putText(img,f"bat {f.get('conf',0):.2f} id {f.get('track_id')}",(a[0],max(24,a[1]-10)),cv2.FONT_HERSHEY_SIMPLEX,.6,(0,180,255),2)
def project3d(joints,size=(640,640)):
    a=np.array(joints,float); xy=a[:,[0,2]]; lo=xy.min(0);hi=xy.max(0); span=max(float((hi-lo).max()),1e-3); xy=(xy-(lo+hi)/2)/span*.72*min(size)+np.array(size)/2; xy[:,1]=size[1]-xy[:,1];return xy.astype(int)
def skeleton_frame(f,size=(640,640)):
    img=np.full((size[1],size[0],3),(25,27,31),np.uint8); pts=project3d(f['joints'],size)
    cv2.line(img,(0,int(size[1]*.82)),(size[0],int(size[1]*.82)),(75,80,88),2)
    for a,b in H36M_BONES:cv2.line(img,tuple(pts[a]),tuple(pts[b]),(70,210,235),5)
    for p in pts:cv2.circle(img,tuple(p),6,(230,230,230),-1)
    cv2.putText(img,"3D reconstructed estimate",(20,35),cv2.FONT_HERSHEY_SIMPLEX,.7,(210,210,210),2);return img
def render(video_path,out_dir,pose,bat,pose3d,metrics):
    cap=cv2.VideoCapture(str(video_path));fps=float(pose['meta']['fps']);w=int(pose['meta']['width']);h=int(pose['meta']['height']);contact=(metrics.get('contact')or{}).get('frame',len(pose['frames'])//2)
    start=max(0,int(contact-3*fps));end=min(len(pose['frames'])-1,int(contact+3*fps));cap.set(cv2.CAP_PROP_POS_FRAMES,start)
    fourcc=cv2.VideoWriter_fourcc(*'mp4v')
    writers={n:cv2.VideoWriter(str(out_dir/n),fourcc,fps,(w,h)) for n in ['pose-overlay.mp4','bat-overlay.mp4','combined-tracking-overlay.mp4']}
    sk=cv2.VideoWriter(str(out_dir/'3d-skeleton-debug.mp4'),fourcc,fps,(640,640)); side=cv2.VideoWriter(str(out_dir/'original-3d-side-by-side.mp4'),fourcc,fps,(1280,720))
    for i in range(start,end+1):
        ok,img=cap.read()
        if not ok:break
        p=img.copy();draw_pose(p,pose['frames'][i]);writers['pose-overlay.mp4'].write(p)
        b=img.copy();draw_bat(b,bat['frames'][i]);writers['bat-overlay.mp4'].write(b)
        c=img.copy();draw_pose(c,pose['frames'][i]);draw_bat(c,bat['frames'][i]);
        if i==contact:cv2.putText(c,"CONTACT ESTIMATE",(40,70),cv2.FONT_HERSHEY_SIMPLEX,1.2,(0,190,255),3)
        writers['combined-tracking-overlay.mp4'].write(c)
        s=skeleton_frame(pose3d['frames'][i]);sk.write(s)
        left=cv2.resize(img,(640,720));right=cv2.resize(s,(640,720));side.write(np.hstack([left,right]))
    cap.release();[x.release() for x in writers.values()];sk.release();side.release()

def main(video_path,out_dir,video_id,filename,video_hash):
    video_path=pathlib.Path(video_path);out_dir=pathlib.Path(out_dir)
    pose=load(out_dir/'pose_2d.json');bat=load(out_dir/'bat_path.json');p3=load(out_dir/'pose_3d.json');metrics=load(out_dir/'metrics.json')
    frames=pose['frames'];bframes=bat['frames'];p3frames=p3['frames'];meta=pose['meta']; tracked=[f for f in p3frames if f.get('tracked')]
    rigid=auto_level(rigidify(p3frames)); before=bone_variance(p3frames);after=bone_variance(rigid)
    foot_before=mean([foot_slide(rigid,3),foot_slide(rigid,6)]);stabilized=lock_foot(lock_foot(rigid,3),6);foot_after=mean([foot_slide(stabilized,3),foot_slide(stabilized,6)])
    pose_cov=coverage(frames,lambda f:sum(1 for p in (f.get('keypoints') or []) if p[2]>=.25)>=10);bat_cov=coverage(bframes,lambda f:f.get('tip') is not None)
    pose3_cov=coverage(p3frames,lambda f:f.get('tracked',False));avg_conf=mean([p[2] for f in frames for p in (f.get('keypoints') or []) if p[2]>0])
    fallback=bool(meta.get('bat_evidence',{}).get('used_fallback')); contact=metrics.get('contact'); warnings=[];errors=[]
    if fallback:warnings.append('Batter selection used longest-track fallback because bat-holding evidence was insufficient.')
    if pose_cov<.7:warnings.append('Low pose coverage; reconstruction is explanatory only.')
    if bat_cov<.25:warnings.append('Low bat coverage; bat gaps are not treated as observed motion.')
    score=.4*pose_cov+.2*pose3_cov+.15*min(1,avg_conf)+.15*max(0,1-after*5)+.1*min(1,bat_cov/.6)
    quality='HIGH' if score>=.8 and not fallback else 'MEDIUM' if score>=.55 else 'LOW'
    gate='GOOD' if quality=='HIGH' else 'LIMITED' if quality=='MEDIUM' else 'UNSUITABLE'
    result={'video_id':video_id,'filename':filename,'video_sha256':video_hash,'fps':meta['fps'],'frame_count':meta['n_frames'],'duration':meta['n_frames']/meta['fps'],'resolution':f"{meta['width']}x{meta['height']}",
      'athlete_track_confidence':max(0,min(1,pose_cov*(.65 if fallback else 1))),'pose_coverage':pose_cov,'average_keypoint_confidence':avg_conf,'bat_track_coverage':bat_cov,
      'swing_frame':contact.get('frame') if contact else None,'contact_frame':contact.get('frame') if contact else None,'swing_detection_confidence':contact.get('confidence') if contact else 'low',
      '3d_reconstruction_status':'available' if gate!='UNSUITABLE' else 'fallback_2d_only','3d_pose_coverage':pose3_cov,'3d_stability_score':max(0,1-root_jitter_2d(frames,meta['width'])*20),
      'root_jitter':root_jitter_2d(frames,meta['width']),'foot_sliding_score_before':foot_before,'foot_sliding_score':foot_after,'bone_length_variance_before':before,'bone_length_variance':after,
      'bat_orientation_discontinuities':bat_discontinuities(bframes,meta['width'],meta['height']),'handedness':'unknown','handedness_confidence':0,
      'video_quality_gate':gate,'overall_reconstruction_quality':quality,'metrics_status':'complete' if contact else 'limited','report_status':'not_generated_local_validation',
      'pipeline_versions':{'pipeline':'barreliq-reconstruction-v1','pose_model':'yolo11m-pose','bat_model':'yolov8m-coco-bat-bytetrack','pose_lifter':'videopose3d-pretrained-h36m-detectron-coco','avatar':'batter-fbx-mixamo-v1'},'warnings':warnings,'errors':errors}
    dump(out_dir/'validation-result.json',result);dump(out_dir/'reconstruction-diagnostics.json',{'before':{'bone_length_variance':before,'foot_sliding_score':foot_before},'after':{'bone_length_variance':after,'foot_sliding_score':foot_after},'root_jitter':result['root_jitter'],'bat_orientation_discontinuities':result['bat_orientation_discontinuities']})
    dump(out_dir/'confidence-summary.json',{'quality':quality,'explanation':{'pose_coverage':pose_cov,'bat_coverage':bat_cov,'occlusion':'high' if pose_cov<.7 else 'low','temporal_stability':'high' if result['3d_stability_score']>.8 else 'limited'},'measurement_notice':'3D values are estimated from monocular video reconstruction; original video is the source of truth.'})
    dump(out_dir/'review-replay.json',{'original_video':str(video_path.resolve()),'animation_source':'pose_3d_stabilized.json','avatar':'coach/assets/models/batter.fbx','master_timeline':{'fps':meta['fps'],'frame_count':meta['n_frames']},'views':['Source','Front','Side','Rear','Pitcher','Batter','Free orbit']})
    dump(out_dir/'pose_3d_stabilized.json',{'meta':{**p3['meta'],'coordinate_system':'X=batter left/right, Y=depth in lifter output, Z=vertical; viewer canonicalizes once','pipeline_version':'barreliq-reconstruction-v1','stabilization':'median bone lengths + low-velocity foot plants'},'frames':stabilized})
    render(video_path,out_dir,pose,bat,{'meta':p3['meta'],'frames':stabilized},metrics)

if __name__=='__main__':
    if len(sys.argv)!=6:raise SystemExit('usage: validation_artifacts.py VIDEO OUT VIDEO_ID FILENAME SHA256')
    main(*sys.argv[1:])
